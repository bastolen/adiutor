/**
 * @file Integration tests for reading one request: its details, who raised it,
 * its priority, its assignees and when things happened, and finding it by its
 * number. Its conversation is tested in `detail-thread.int.test.ts`. Which
 * roles may read which requests is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { company as companyTable, user } from '@/db/schema';

import {
  actorFor,
  createCompany,
  createStaffSettings,
  memberActor,
  minutesAgo,
  saveSettings,
  staffActor,
} from '../../../tests/integration/helpers';
import { findRequest, findRequestNumber, getRequest } from './detail';
import mentionKey from './mention-key';
import raiseRequest from './raise';
import {
  ctx,
  db,
  storeAssignees,
  storeEntry,
  storeRequest,
  REQUEST_READERS,
  requestReader,
} from './test-helpers';

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
      description: { text: 'It prints blank pages.', format: 'markdown' },
      type: 'hotfix',
      status: 'open',
      reopenedAt: null,
      raisedBy: { userId: null, name: 'casey', side: 'company', isViewer: true, picture: null },
      company: {
        id: company.id,
        name: 'Adiutor Tests Alpha',
        slug: 'adiutor-tests-alpha',
        deactivated: false,
      },
      staffName: 'Adiutor Tests',
      entries: [],
      earlierEntries: 0,
      earlierChunks: 0,
    });
    expect(detail.createdAt).toEqual(stored.createdAt);
  });

  it('says who raised a request for someone to every reader, and nothing for one raised by its author', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const colleague = await memberActor(db, company.id, 'client', 'colin@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await raiseRequest(ctx, support, {
      companyId: company.id,
      title: 'The printer is broken',
      description: 'They called about it.',
      type: 'bug',
      raisedFor: mentionKey(company.id, client.id),
    });
    const own = await storeRequest(company.id, { createdBy: client.id });

    const forClient = await getRequest(ctx, client, raised.id);
    expect(forClient).toMatchObject({
      raisedBy: { userId: null, name: 'casey', side: 'company', isViewer: true },
      raisedOnBehalf: { userId: null, name: 'sam', side: 'staff', isViewer: false },
    });
    expect((await getRequest(ctx, colleague, raised.id)).raisedOnBehalf).toMatchObject({
      name: 'sam',
      isViewer: false,
    });
    // The staff have a page for every user, which the names link to.
    expect(await getRequest(ctx, support, raised.id)).toMatchObject({
      raisedBy: { userId: client.id, name: 'casey', side: 'company', isViewer: false },
      raisedOnBehalf: { userId: support.id, name: 'sam', side: 'staff', isViewer: true },
    });
    expect(await getRequest(ctx, client, own.id)).not.toHaveProperty('raisedOnBehalf');

    // Once the staff member's account is gone, the request still says the staff raised it.
    await db.delete(user).where(eq(user.id, support.id));
    expect((await getRequest(ctx, client, raised.id)).raisedOnBehalf).toEqual({
      userId: null,
      name: null,
      side: 'staff',
      isViewer: false,
      picture: null,
    });
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
    expect(forStaff.company?.deactivated).toBe(true);
    await expect(getRequest(ctx, await actorFor(db, admin.id), '1')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it.each(REQUEST_READERS)(
    'tells %s how they are addressed and what they may do',
    async (_who, companyRole, staffRole, audience, contributes, manages) => {
      const company = await createCompany(db);
      await storeRequest(company.id);
      const reader = await requestReader(company.id, companyRole, staffRole);

      const detail = await getRequest(ctx, reader, '1');

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

describe('getRequest: the assignees', () => {
  it('gives everyone on the request the staff it is assigned to, by name, and their IDs only to the staff', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    await db.update(user).set({ name: 'Sam Support' }).where(eq(user.id, support.id));
    await db.update(user).set({ name: 'Morgan Manager' }).where(eq(user.id, manager.id));
    const stored = await storeRequest(company.id);
    await storeAssignees(stored.id, [support.id, manager.id]);

    const forStaff = await getRequest(ctx, support, stored.id);
    const forClient = await getRequest(ctx, client, stored.id);

    expect(forStaff.assignees).toEqual([
      { userId: manager.id, name: 'Morgan Manager', side: 'staff', isViewer: false, picture: null },
      { userId: support.id, name: 'Sam Support', side: 'staff', isViewer: true, picture: null },
    ]);
    expect(forClient.assignees).toEqual([
      { userId: null, name: 'Morgan Manager', side: 'staff', isViewer: false, picture: null },
      { userId: null, name: 'Sam Support', side: 'staff', isViewer: false, picture: null },
    ]);
  });

  it('has nobody while the request is not assigned', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const stored = await storeRequest(company.id);

    expect((await getRequest(ctx, support, stored.id)).assignees).toEqual([]);
  });

  it('says who each assignment entry is about, on the staff side, without a name once the account is gone', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const gone = await staffActor(db, 'manager');
    await db.update(user).set({ name: 'Sam Support' }).where(eq(user.id, support.id));
    const stored = await storeRequest(company.id);
    await storeEntry(stored.id, {
      kind: 'assignee',
      authorId: support.id,
      authorSide: 'staff',
      subjectUserId: support.id,
      toValue: 'assigned',
    });
    await storeEntry(stored.id, {
      kind: 'assignee',
      authorId: support.id,
      authorSide: 'staff',
      subjectUserId: gone.id,
      toValue: 'unassigned',
    });
    await storeEntry(stored.id, { authorId: client.id });
    await db.delete(user).where(eq(user.id, gone.id));

    const { entries } = await getRequest(ctx, client, stored.id);

    expect(
      entries.map(({ kind, to, subject, subjectIsAuthor }) => ({
        kind,
        to,
        subject,
        subjectIsAuthor,
      })),
    ).toEqual([
      {
        kind: 'assignee',
        to: 'assigned',
        subject: {
          userId: null,
          name: 'Sam Support',
          side: 'staff',
          isViewer: false,
          picture: null,
        },
        subjectIsAuthor: true,
      },
      {
        kind: 'assignee',
        to: 'unassigned',
        subject: { userId: null, name: null, side: 'staff', isViewer: false, picture: null },
        subjectIsAuthor: false,
      },
      { kind: 'comment', to: null, subject: null, subjectIsAuthor: false },
    ]);
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

describe('findRequestNumber', () => {
  it('reads the number, or the number after the prefix the staff chose, and nothing else', async () => {
    await createStaffSettings(db);
    await saveSettings(db, { 'requests.prefix': 'HELP' });

    expect(await findRequestNumber(ctx, '12')).toBe(12);
    expect(await findRequestNumber(ctx, 'HELP-12')).toBe(12);
    expect(await findRequestNumber(ctx, 'help-12')).toBe(12);
    // The prefix before the change no longer counts.
    expect(await findRequestNumber(ctx, 'AD-12')).toBeNull();
    expect(await findRequestNumber(ctx, 'abc')).toBeNull();
  });

  it('reads "AD" before Adiutor is set up', async () => {
    expect(await findRequestNumber(ctx, 'AD-3')).toBe(3);
  });
});

describe('findRequest', () => {
  it('gives the number and the prefix the staff chose', async () => {
    await createStaffSettings(db);
    await saveSettings(db, { 'requests.prefix': 'HELP' });
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
