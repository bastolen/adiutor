/**
 * @file Integration tests for reading one request with its conversation.
 * Which roles may read which requests is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { company as companyTable, requestEntry, user } from '@/db/schema';
import { defined } from '@/lib/defined';

import {
  actorFor,
  createCompany,
  createStaffSettings,
  createUser,
  inSequence,
  memberActor,
  minutesAgo,
  saveSettings,
  staffActor,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { setActivityView } from './activity-view';
import {
  findRequest,
  findRequestNumber,
  getRequest,
  MAX_EARLIER_CHUNKS,
  THREAD_CHUNK,
} from './detail';
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
    expect(forStaff.company.deactivated).toBe(true);
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

describe('getRequest: the conversation', () => {
  it('gives the entries oldest first, with who wrote them', async () => {
    await createStaffSettings(db, 'Adiutor Tests');
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const stored = await storeRequest(company.id, { createdBy: client.id });
    // The first reply is from before Markdown: each text comes with the format it was stored in.
    await storeEntry(stored.id, { authorId: client.id, body: 'Any news?', bodyFormat: 'plain' });
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
        author: { userId: null, name: 'casey', side: 'company', isViewer: true, picture: null },
        // Their own reply, which they may edit: the editor starts from its text.
        body: {
          text: 'Any news?',
          format: 'plain',
          editedAt: null,
          edit: { markdown: 'Any news?', edits: 0 },
        },
        from: null,
        to: null,
      },
      {
        kind: 'comment',
        author: { userId: null, name: 'sam', side: 'staff', isViewer: false, picture: null },
        body: { text: 'On it.', format: 'markdown', editedAt: null },
        from: null,
        to: null,
      },
      {
        kind: 'title',
        author: { userId: null, name: 'sam', side: 'staff', isViewer: false, picture: null },
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

    expect(detail.raisedBy).toEqual({
      userId: null,
      name: null,
      side: 'staff',
      isViewer: false,
      picture: null,
    });
    expect(detail.entries).toMatchObject([
      {
        author: { userId: null, name: null, side: 'staff', isViewer: false, picture: null },
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

  it('gives no name, and never an address, for someone without a name or whose account is gone', async () => {
    const company = await createCompany(db);
    const nameless = await createUser(db, 'nameless@adiutor.test');
    await db.update(user).set({ name: '  ' }).where(eq(user.id, nameless));
    const gone = await createUser(db, 'gone@adiutor.test');
    // An old name of only characters that show nothing: a zero-width space and a Hangul filler.
    const invisible = await createUser(db, 'invisible@adiutor.test');
    await db.update(user).set({ name: '\u{200B}\u{3164}' }).where(eq(user.id, invisible));
    await storeRequest(company.id, { title: 'Nameless', createdBy: nameless });
    await storeRequest(company.id, { title: 'Gone', createdBy: gone, createdBySide: 'staff' });
    await storeRequest(company.id, { title: 'Invisible', createdBy: invisible });
    await db.delete(user).where(eq(user.id, gone));
    const watcher = await memberActor(db, company.id, 'watcher');

    const first = await getRequest(ctx, watcher, '1');
    const second = await getRequest(ctx, watcher, '2');
    const third = await getRequest(ctx, watcher, '3');

    expect(first.raisedBy).toEqual({
      userId: null,
      name: null,
      side: 'company',
      isViewer: false,
      picture: null,
    });
    expect(second.raisedBy).toEqual({
      userId: null,
      name: null,
      side: 'staff',
      isViewer: false,
      picture: null,
    });
    expect(third.raisedBy).toEqual({
      userId: null,
      name: null,
      side: 'company',
      isViewer: false,
      picture: null,
    });
    expect(JSON.stringify([first, second, third])).not.toContain('@adiutor.test');
    // Nor who it is: the nameless accounts still exist.
    expect(JSON.stringify([first, second, third])).not.toContain(nameless);
    expect(JSON.stringify([first, second, third])).not.toContain(invisible);
  });

  it('gives nobody the ID of an account that is gone', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    await storeRequest(company.id, { createdBy: client.id });
    await db.delete(user).where(eq(user.id, client.id));

    const detail = await getRequest(ctx, support, '1');

    expect(detail.raisedBy).toEqual({
      userId: null,
      name: null,
      side: 'company',
      isViewer: false,
      picture: null,
    });
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

  it('shows the conversation down to the entry a link points at, and earlier chunks from there', async () => {
    const company = await createCompany(db);
    const stored = await storeRequest(company.id);
    const replies = await inSequence(
      Array.from({ length: THREAD_CHUNK * 2 + 20 }, (_, index) => index + 1),
      (n) => storeEntry(stored.id, { body: `Reply ${n}` }),
    );
    const client = await memberActor(db, company.id, 'client');
    /**
     * What a reader gets when a link points at a reply: the first and last
     * reply shown, how many are shown, how many are earlier, and how many
     * earlier chunks are shown.
     *
     * @param reply - The number of the reply the link points at.
     * @param earlier - How many earlier chunks the address asks for.
     * @returns What's shown.
     */
    const linkedTo = async (reply: number, earlier?: number) => {
      const linked = defined(replies[reply - 1], `reply ${reply}`);
      const detail = await getRequest(ctx, client, '1', { entry: linked.id, earlier });
      expect(detail.entries.some(({ id }) => id === linked.id)).toBe(true);
      return [
        detail.entries.at(0)?.body?.text,
        detail.entries.at(-1)?.body?.text,
        detail.entries.length,
        detail.earlierEntries,
        detail.earlierChunks,
      ];
    };

    // The oldest of the latest chunk takes nothing more; the one before it takes a chunk.
    expect(await linkedTo(71)).toEqual(['Reply 71', 'Reply 120', THREAD_CHUNK, 70, 0]);
    expect(await linkedTo(70)).toEqual(['Reply 21', 'Reply 120', THREAD_CHUNK * 2, 20, 1]);
    expect(await linkedTo(21)).toEqual(['Reply 21', 'Reply 120', THREAD_CHUNK * 2, 20, 1]);
    expect(await linkedTo(20)).toEqual(['Reply 1', 'Reply 120', 120, 0, 2]);
    // More chunks asked for than it takes are shown as asked.
    expect(await linkedTo(30, 2)).toEqual(['Reply 1', 'Reply 120', 120, 0, 2]);

    // With the newest first, the same entries, the other way around.
    await setActivityView(ctx, client, { order: 'newest' });
    expect(await linkedTo(30)).toEqual(['Reply 120', 'Reply 21', THREAD_CHUNK * 2, 20, 1]);
  });

  it('reaches down to an entry a link points at only when the reader is shown it', async () => {
    const company = await createCompany(db);
    // Another request's entry, older than every entry of this one.
    const elsewhere = await storeEntry((await storeRequest(company.id)).id);
    const stored = await storeRequest(company.id);
    const note = await storeEntry(stored.id, {
      kind: 'note',
      authorSide: 'staff',
      body: 'A note for the staff',
    });
    await inSequence(
      Array.from({ length: THREAD_CHUNK + 10 }, (_, index) => index + 1),
      (n) => storeEntry(stored.id, { body: `Reply ${n}` }),
    );
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');

    // Someone at the company never gets the note, nor the chunk it would take.
    const forClient = await getRequest(ctx, client, stored.id, { entry: note.id });
    expect(forClient.entries).toHaveLength(THREAD_CHUNK);
    expect(forClient.entries.some(({ kind }) => kind === 'note')).toBe(false);
    expect([forClient.earlierEntries, forClient.earlierChunks]).toEqual([10, 0]);
    const toElsewhere = await getRequest(ctx, client, stored.id, { entry: elsewhere.id });
    expect([toElsewhere.entries.length, toElsewhere.earlierChunks]).toEqual([THREAD_CHUNK, 0]);

    // The staff get it, with everything down to it.
    const forStaff = await getRequest(ctx, support, stored.id, { entry: note.id });
    expect(forStaff.entries.at(0)?.id).toBe(note.id);
    expect([forStaff.earlierEntries, forStaff.earlierChunks]).toEqual([0, 1]);
  });

  it('reaches down to the oldest entry every earlier chunk holds, and opens as asked for one further back', async () => {
    const company = await createCompany(db);
    const stored = await storeRequest(company.id);
    const first = await storeEntry(stored.id, { body: 'The first reply' });
    const second = await storeEntry(stored.id, { body: 'The second reply' });
    const shownAtMost = THREAD_CHUNK * (MAX_EARLIER_CHUNKS + 1);
    // With the second reply, as many entries as every chunk holds.
    await db.insert(requestEntry).values(
      Array.from({ length: shownAtMost - 1 }, () => ({
        requestId: stored.id,
        kind: 'comment' as const,
        authorSide: 'company' as const,
        body: 'A later reply',
      })),
    );
    const client = await memberActor(db, company.id, 'client');

    // The second reply is the oldest every chunk holds: it's shown as the oldest, the first isn't.
    const toSecond = await getRequest(ctx, client, stored.id, { entry: second.id });
    expect(toSecond.entries).toHaveLength(shownAtMost);
    expect(toSecond.entries.at(0)?.id).toBe(second.id);
    expect(toSecond.entries.some(({ id }) => id === first.id)).toBe(false);
    expect([toSecond.earlierEntries, toSecond.earlierChunks]).toEqual([1, MAX_EARLIER_CHUNKS]);

    // The first is further back than every chunk reaches: the page opens as asked, not with them all.
    const toFirst = await getRequest(ctx, client, stored.id, { entry: first.id });
    expect(toFirst.entries).toHaveLength(THREAD_CHUNK);
    expect([toFirst.earlierEntries, toFirst.earlierChunks]).toEqual([
      shownAtMost + 1 - THREAD_CHUNK,
      0,
    ]);
  });

  it('counts only the newer entries of the groups the reader shows', async () => {
    const company = await createCompany(db);
    const stored = await storeRequest(company.id);
    const linked = await storeEntry(stored.id, { body: 'The reply a link points at' });
    await db.insert(requestEntry).values(
      Array.from({ length: THREAD_CHUNK }, () => ({
        requestId: stored.id,
        kind: 'status' as const,
        authorSide: 'staff' as const,
        fromValue: 'open',
        toValue: 'todo',
      })),
    );
    await storeEntry(stored.id, { body: 'The latest reply' });
    const client = await memberActor(db, company.id, 'client');

    // Everything shown: 51 newer entries take a chunk more.
    expect((await getRequest(ctx, client, stored.id, { entry: linked.id })).earlierChunks).toBe(1);

    // Only the replies: one newer reply, so the latest chunk holds it.
    await setActivityView(ctx, client, { groups: ['replies'] });
    const replies = await getRequest(ctx, client, stored.id, { entry: linked.id });
    expect(replies.entries.map(({ body }) => body?.text)).toEqual([
      'The reply a link points at',
      'The latest reply',
    ]);
    expect([replies.earlierEntries, replies.earlierChunks]).toEqual([0, 0]);
  });
});

describe('getRequest: the reader’s activity view', () => {
  /**
   * Stores a request with a reply, an internal note, a status change and a
   * change of priority, in that order.
   *
   * @returns The company, the request and its entries.
   */
  const storeMixedRequest = async () => {
    const company = await createCompany(db);
    const stored = await storeRequest(company.id);
    const entries = await inSequence(
      [
        { body: 'A reply' },
        { kind: 'note' as const, authorSide: 'staff' as const, body: 'A note' },
        {
          kind: 'status' as const,
          authorSide: 'staff' as const,
          fromValue: 'open',
          toValue: 'todo',
        },
        {
          kind: 'priority' as const,
          authorSide: 'staff' as const,
          fromValue: 'normal',
          toValue: 'high',
        },
      ],
      (values) => storeEntry(stored.id, values),
    );
    return { company, stored, entries };
  };

  /**
   * The kinds of entry a reader gets, in the order they get them.
   *
   * @param actor - The reader.
   * @returns The kinds.
   */
  const kindsFor = async (actor: Actor) =>
    (await getRequest(ctx, actor, '1')).entries.map(({ kind }) => kind);

  it('shows everything, oldest first, until the reader chooses', async () => {
    await storeMixedRequest();
    const support = await staffActor(db, 'support');

    const detail = await getRequest(ctx, support, '1');
    expect(detail.activity).toEqual({ order: 'oldest', groups: null });
    expect(detail.entries.map(({ kind }) => kind)).toEqual([
      'comment',
      'note',
      'status',
      'priority',
    ]);
  });

  it('shows the newest first, and earlier entries below them a chunk at a time', async () => {
    const company = await createCompany(db);
    const stored = await storeRequest(company.id);
    await inSequence(
      Array.from({ length: THREAD_CHUNK + 5 }, (_, index) => index + 1),
      (n) => storeEntry(stored.id, { body: `Reply ${n}` }),
    );
    const client = await memberActor(db, company.id, 'client');
    await setActivityView(ctx, client, { order: 'newest' });

    const latest = await getRequest(ctx, client, '1');
    expect(latest.activity.order).toBe('newest');
    expect([latest.entries.at(0)?.body?.text, latest.entries.at(-1)?.body?.text]).toEqual([
      `Reply ${THREAD_CHUNK + 5}`,
      'Reply 6',
    ]);
    expect(latest.earlierEntries).toBe(5);

    const all = await getRequest(ctx, client, '1', { earlier: 1 });
    expect(all.entries.at(-1)?.body?.text).toBe('Reply 1');
    expect(all.earlierEntries).toBe(0);
  });

  it('gives the staff the notes with the replies, and the notes alone when they choose them', async () => {
    await storeMixedRequest();
    const support = await staffActor(db, 'support');

    await setActivityView(ctx, support, { groups: ['replies'] });
    expect(await kindsFor(support)).toEqual(['comment', 'note']);

    await setActivityView(ctx, support, { groups: ['notes'] });
    expect(await kindsFor(support)).toEqual(['note']);

    await setActivityView(ctx, support, { groups: ['status', 'changes'] });
    expect(await kindsFor(support)).toEqual(['status', 'priority']);
  });

  it('never shows someone at the company a note, whatever they saved', async () => {
    const { company } = await storeMixedRequest();
    const client = await memberActor(db, company.id, 'client');
    // Saved while they were on the staff: the notes aren't theirs to choose anymore.
    await setActivityView(ctx, client, { groups: ['notes'] });

    const detail = await getRequest(ctx, client, '1');
    expect(detail.activity.groups).toBeNull();
    expect(detail.entries.map(({ kind }) => kind)).toEqual(['comment', 'status']);

    await setActivityView(ctx, client, { groups: ['notes', 'status'] });
    expect((await getRequest(ctx, client, '1')).activity.groups).toEqual(['status']);
    expect(await kindsFor(client)).toEqual(['status']);

    await setActivityView(ctx, client, { groups: ['replies', 'changes'] });
    expect(await kindsFor(client)).toEqual(['comment']);
  });

  it('keeps the entry a link points at, whatever the groups, within what the reader may see', async () => {
    const { company, entries } = await storeMixedRequest();
    const [reply, note] = entries;
    const support = await staffActor(db, 'support');
    const client = await memberActor(db, company.id, 'client');
    await setActivityView(ctx, support, { groups: ['status'] });
    await setActivityView(ctx, client, { groups: ['status'] });

    /**
     * The kinds of entry a reader gets when a link points at an entry.
     *
     * @param actor - The reader.
     * @param entry - What the link names as the entry.
     * @returns The kinds.
     */
    const linkedFor = async (actor: Actor, entry: string) =>
      (await getRequest(ctx, actor, '1', { entry })).entries.map(({ kind }) => kind);

    expect(await linkedFor(support, defined(note, 'the note').id)).toEqual(['note', 'status']);
    expect(await linkedFor(client, defined(reply, 'the reply').id)).toEqual(['comment', 'status']);
    // Never a note for someone at the company, and nothing for what isn't an entry's ID.
    expect(await linkedFor(client, defined(note, 'the note').id)).toEqual(['status']);
    expect(await linkedFor(client, 'not-an-id')).toEqual(['status']);
  });

  it('counts only the earlier entries of the groups shown', async () => {
    const company = await createCompany(db);
    const stored = await storeRequest(company.id);
    await inSequence(
      Array.from({ length: THREAD_CHUNK + 3 }, (_, index) => index + 1),
      async (n) => {
        await storeEntry(stored.id, { body: `Reply ${n}` });
        await storeEntry(stored.id, {
          kind: 'status',
          authorSide: 'staff',
          fromValue: 'open',
          toValue: 'todo',
        });
      },
    );
    const client = await memberActor(db, company.id, 'client');

    expect((await getRequest(ctx, client, '1')).earlierEntries).toBe(THREAD_CHUNK + 6);
    await setActivityView(ctx, client, { groups: ['replies'] });
    const replies = await getRequest(ctx, client, '1');
    expect(replies.entries).toHaveLength(THREAD_CHUNK);
    expect(replies.entries.every(({ kind }) => kind === 'comment')).toBe(true);
    expect(replies.earlierEntries).toBe(3);
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
