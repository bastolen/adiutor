/**
 * @file Integration tests for reading one request with its conversation.
 * Which roles may read which requests is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { company as companyTable, staffSettings, user } from '@/db/schema';

import {
  actorFor,
  addMember,
  createCompany,
  createStaffSettings,
  inSequence,
  memberActor,
  minutesAgo,
  staffActor,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { findRequest, getRequest, THREAD_CHUNK } from './detail';
import { ctx, db, storeEntry, storeRequest } from './test-helpers';

describe('getRequest', () => {
  it('gives a request with its company, who raised it and how its number is shown', async () => {
    await createStaffSettings(db, 'Adiutor Tests');
    const company = await createCompany(db, {
      name: 'Adiutor Tests Alpha',
      slug: 'adiutor-tests-alpha',
    });
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const stored = await storeRequest(company.id, {
      title: 'The printer is broken',
      description: 'It prints blank pages.',
      type: 'hotfix',
      priority: 'high',
      createdBy: client.id,
    });

    const detail = await getRequest(ctx, client, String(stored.number));

    expect(detail).toMatchObject({
      id: stored.id,
      number: 1,
      prefix: 'AD',
      title: 'The printer is broken',
      description: { text: 'It prints blank pages.', format: 'plain' },
      type: 'hotfix',
      status: 'open',
      reopenedAt: null,
      raisedBy: { userId: null, name: 'casey', side: 'company', isViewer: true },
      company: {
        id: company.id,
        name: 'Adiutor Tests Alpha',
        slug: 'adiutor-tests-alpha',
        deactivated: false,
      },
      staffName: 'Adiutor Tests',
      entries: [],
      earlierEntries: 0,
    });
    expect(detail.createdAt).toEqual(stored.createdAt);
  });

  it('finds a request by its number or its ID', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    await storeRequest(company.id, { title: 'First' });
    const second = await storeRequest(company.id, { title: 'Second' });

    expect((await getRequest(ctx, client, '2')).title).toBe('Second');
    expect((await getRequest(ctx, client, second.id)).title).toBe('Second');
  });

  it.each(['3', '0', '-1', '1.0', 'AD-1', 'abc', '', '99999999999'])(
    'reports %j as not found',
    async (ref) => {
      const company = await createCompany(db);
      const client = await memberActor(db, company.id, 'client');
      await storeRequest(company.id);

      await expect(getRequest(ctx, client, ref)).rejects.toMatchObject({ code: 'not_found' });
    },
  );

  it('reports another company’s request as not found, like one that does not exist', async () => {
    const [own, other] = [await createCompany(db), await createCompany(db)];
    const client = await memberActor(db, own.id, 'client');
    const theirs = await storeRequest(other.id);

    await expect(getRequest(ctx, client, '1')).rejects.toMatchObject({ code: 'not_found' });
    await expect(getRequest(ctx, client, theirs.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(findRequest(ctx, client, '1')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('shows a deactivated company’s request to the staff, and no longer to its members', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin');
    await storeRequest(company.id);
    await db
      .update(companyTable)
      .set({ deactivatedAt: new Date() })
      .where(eq(companyTable.id, company.id));

    const forStaff = await getRequest(ctx, await staffActor(db, 'finance'), '1');
    expect(forStaff.company.deactivated).toBe(true);
    await expect(getRequest(ctx, await actorFor(db, admin.id), '1')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it.each([
    ['a Client', 'client', null, 'contributor', true, false],
    ['a Watcher', 'watcher', null, 'follower', false, false],
    ['Support', null, 'support', 'staff', true, true],
    ['Finance', null, 'finance', 'staff', false, false],
    ['Finance who is also a Client', 'client', 'finance', 'contributor', true, false],
  ] as const)(
    'tells %s how they are addressed and what they may do',
    async (_who, companyRole, staffRole, audience, contributes, manages) => {
      const company = await createCompany(db);
      await storeRequest(company.id);
      const base = staffRole
        ? await staffActor(db, staffRole)
        : await memberActor(db, company.id, companyRole);
      if (staffRole && companyRole) {
        await addMember(db, company.id, base.id, companyRole);
      }

      const detail = await getRequest(ctx, await actorFor(db, base.id), '1');

      expect(detail.audience).toBe(audience);
      expect(detail.permissions.has('requests:contribute')).toBe(contributes);
      expect(detail.permissions.has('requests:manage')).toBe(manages);
    },
  );
});

describe('getRequest: the priority', () => {
  it('is for the staff only, with the history of its changes', async () => {
    const company = await createCompany(db);
    const stored = await storeRequest(company.id, { priority: 'high' });
    await storeEntry(stored.id, { body: 'Any news?' });
    await storeEntry(stored.id, {
      kind: 'priority',
      authorSide: 'staff',
      fromValue: 'normal',
      toValue: 'high',
    });
    await storeEntry(stored.id, {
      kind: 'status',
      authorSide: 'staff',
      fromValue: 'open',
      toValue: 'todo',
    });

    const forStaff = await getRequest(ctx, await staffActor(db, 'finance'), '1');
    expect(forStaff.priority).toBe('high');
    expect(forStaff.entries.map(({ kind }) => kind)).toEqual(['comment', 'priority', 'status']);

    const forClient = await getRequest(ctx, await memberActor(db, company.id, 'client'), '1');
    expect(forClient.priority).toBeNull();
    expect(forClient.entries.map(({ kind }) => kind)).toEqual(['comment', 'status']);
    expect(forClient.earlierEntries).toBe(0);
    expect(JSON.stringify(forClient)).not.toContain('high');
  });
});

describe('getRequest: the conversation', () => {
  it('gives the entries oldest first, with who wrote them', async () => {
    await createStaffSettings(db, 'Adiutor Tests');
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const stored = await storeRequest(company.id, { createdBy: client.id });
    await storeEntry(stored.id, { authorId: client.id, body: 'Any news?' });
    await storeEntry(stored.id, { authorId: support.id, authorSide: 'staff', body: 'On it.' });
    await storeEntry(stored.id, {
      kind: 'title',
      authorId: support.id,
      authorSide: 'staff',
      fromValue: 'Help',
      toValue: 'The printer is broken',
    });

    const detail = await getRequest(ctx, client, '1');

    expect(
      detail.entries.map(({ kind, author, body, from, to }) => ({ kind, author, body, from, to })),
    ).toEqual([
      {
        kind: 'comment',
        author: { userId: null, name: 'casey', side: 'company', isViewer: true },
        body: { text: 'Any news?', format: 'plain' },
        from: null,
        to: null,
      },
      {
        kind: 'comment',
        author: { userId: null, name: 'sam', side: 'staff', isViewer: false },
        body: { text: 'On it.', format: 'plain' },
        from: null,
        to: null,
      },
      {
        kind: 'title',
        author: { userId: null, name: 'sam', side: 'staff', isViewer: false },
        body: null,
        from: 'Help',
        to: 'The printer is broken',
      },
    ]);
  });

  it('keeps what someone wrote, with their side and without their name, once their account is gone', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const stored = await storeRequest(company.id, {
      createdBy: support.id,
      createdBySide: 'staff',
    });
    await storeEntry(stored.id, { authorId: support.id, authorSide: 'staff', body: 'On it.' });
    await db.delete(user).where(eq(user.id, support.id));

    const detail = await getRequest(ctx, await memberActor(db, company.id, 'watcher'), '1');

    expect(detail.raisedBy).toEqual({ userId: null, name: null, side: 'staff', isViewer: false });
    expect(detail.entries).toMatchObject([
      {
        author: { userId: null, name: null, side: 'staff', isViewer: false },
        body: { text: 'On it.' },
      },
    ]);
  });

  it('gives the staff, who have a page for every user, the ID of everyone in it; nobody at the company gets one', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const watcher = await memberActor(db, company.id, 'watcher', 'wren@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const finance = await staffActor(db, 'finance', 'frankie@adiutor.test');
    const stored = await storeRequest(company.id, { createdBy: client.id });
    await storeEntry(stored.id, { authorId: support.id, authorSide: 'staff', body: 'On it.' });

    /**
     * The IDs a reader gets: of who raised the request, then of who wrote its entries.
     *
     * @param reader - Whoever reads the request.
     * @returns The IDs.
     */
    const idsFor = async (reader: Actor) => {
      const detail = await getRequest(ctx, reader, '1');
      return [detail.raisedBy.userId, ...detail.entries.map(({ author }) => author.userId)];
    };

    // Those who work on requests, and Finance, who only reads them.
    expect(await idsFor(support)).toEqual([client.id, support.id]);
    expect(await idsFor(finance)).toEqual([client.id, support.id]);
    // Not even their own.
    expect(await idsFor(client)).toEqual([null, null]);
    expect(await idsFor(watcher)).toEqual([null, null]);
    expect(JSON.stringify(await getRequest(ctx, watcher, '1'))).not.toContain(client.id);
  });

  it('gives nobody the ID of an account that is gone', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    await storeRequest(company.id, { createdBy: client.id });
    await db.delete(user).where(eq(user.id, client.id));

    const detail = await getRequest(ctx, support, '1');

    expect(detail.raisedBy).toEqual({ userId: null, name: null, side: 'company', isViewer: false });
  });

  it('gives the latest entries, and earlier ones a chunk at a time', async () => {
    const company = await createCompany(db);
    const stored = await storeRequest(company.id);
    const total = THREAD_CHUNK * 2 + 5;
    await inSequence(
      Array.from({ length: total }, (_, index) => index + 1),
      (n) => storeEntry(stored.id, { body: `Reply ${n}` }),
    );
    const client = await memberActor(db, company.id, 'client');
    /**
     * The first and last reply of what a reader gets, and how many are earlier.
     *
     * @param earlier - How many earlier chunks they asked for.
     * @returns The first reply, the last reply, how many are shown and how many are earlier.
     */
    const shown = async (earlier?: number) => {
      const { entries, earlierEntries } = await getRequest(ctx, client, '1', { earlier });
      return [
        entries.at(0)?.body?.text,
        entries.at(-1)?.body?.text,
        entries.length,
        earlierEntries,
      ];
    };

    expect(await shown()).toEqual(['Reply 56', 'Reply 105', THREAD_CHUNK, 55]);
    expect(await shown(1)).toEqual(['Reply 6', 'Reply 105', THREAD_CHUNK * 2, 5]);
    expect(await shown(2)).toEqual(['Reply 1', 'Reply 105', total, 0]);
    // Anything that isn't a number of chunks shows the latest only.
    expect(await shown(-3)).toEqual(['Reply 56', 'Reply 105', THREAD_CHUNK, 55]);
    expect(await shown(Number.NaN)).toEqual(['Reply 56', 'Reply 105', THREAD_CHUNK, 55]);
    expect(await shown(1.5)).toEqual(['Reply 56', 'Reply 105', THREAD_CHUNK, 55]);
  });
});

describe('getRequest: when things happened', () => {
  it('says when the staff first replied, and when the request last had activity', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const [raisedAt, firstAt, laterAt] = [minutesAgo(600), minutesAgo(480), minutesAgo(60)];
    const stored = await storeRequest(company.id, { createdAt: raisedAt, lastActivityAt: laterAt });
    // A reply from the company and a change by the staff are no response from the staff.
    await storeEntry(stored.id, { body: 'Any news?', createdAt: minutesAgo(540) });
    await storeEntry(stored.id, {
      kind: 'status',
      authorSide: 'staff',
      fromValue: 'open',
      toValue: 'todo',
      createdAt: minutesAgo(500),
    });
    await storeEntry(stored.id, { authorSide: 'staff', body: 'On it.', createdAt: firstAt });
    await storeEntry(stored.id, { authorSide: 'staff', body: 'Fixed.', createdAt: laterAt });

    const detail = await getRequest(ctx, client, '1');

    expect(detail.createdAt).toEqual(raisedAt);
    expect(detail.firstResponseAt).toEqual(firstAt);
    expect(detail.lastActivityAt).toEqual(laterAt);
  });

  it('has no first response while the staff have not replied', async () => {
    const company = await createCompany(db);
    const stored = await storeRequest(company.id);
    await storeEntry(stored.id, { body: 'Any news?' });

    const detail = await getRequest(ctx, await staffActor(db, 'support'), '1');

    expect(detail.firstResponseAt).toBeNull();
    expect(detail.lastActivityAt).toEqual(stored.lastActivityAt);
  });
});

describe('findRequest', () => {
  it('gives the number and the prefix the staff chose', async () => {
    await createStaffSettings(db);
    await db.update(staffSettings).set({ requestPrefix: 'HELP' });
    const company = await createCompany(db);
    await storeRequest(company.id);
    const second = await storeRequest(company.id);

    expect(await findRequest(ctx, await staffActor(db, 'support'), second.id)).toEqual({
      number: 2,
      prefix: 'HELP',
    });
  });

  it('shows numbers with "AD" before Adiutor is set up', async () => {
    const company = await createCompany(db);
    await storeRequest(company.id);

    expect(await findRequest(ctx, await memberActor(db, company.id, 'watcher'), '1')).toEqual({
      number: 1,
      prefix: 'AD',
    });
  });
});
