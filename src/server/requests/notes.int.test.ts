/**
 * @file Integration tests for internal notes: who may add one, that it
 * changes nothing the company sees, its mentions, and that only the staff
 * read it. Which roles may add notes is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { requestEntry, requestMention } from '@/db/schema';
import { appUrl } from '@/lib/env';
import { storedMentionMarker, writtenMentionMarker } from '@/lib/requests';

import {
  createCompany,
  createStaffSettings,
  fillRateLimitBucket,
  memberActor,
  minutesAgo,
  staffActor,
} from '../../../tests/integration/helpers';
import { RATE_LIMITS } from '../rate-limit';
import { getRequest, THREAD_CHUNK } from './detail';
import { editReply } from './edits';
import mentionKey from './mention-key';
import { listMentionable } from './mentions';
import addNote from './notes';
import { loadSubscribers } from './participants';
import { ctx, db, storeEntry, storeRequest, storedRequest, entriesOf } from './test-helpers';

/**
 * The entries of a request's history, in order.
 *
 * @param requestId - The request.
 * @returns Each entry's kind, author, side and text.
 */
async function history(requestId: string) {
  const entries = await entriesOf(requestId);
  return entries.map(({ kind, authorId, authorSide, body, bodyFormat }) => ({
    kind,
    authorId,
    authorSide,
    body,
    bodyFormat,
  }));
}

describe('addNote', () => {
  it('adds a note from the staff, and changes nothing the company sees', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raisedAt = minutesAgo(60);
    const raised = await storeRequest(company.id, {
      status: 'waiting',
      createdAt: raisedAt,
      lastActivityAt: raisedAt,
    });

    await addNote(ctx, support, {
      request: String(raised.number),
      body: '  Probably the toner.\r\nCheck before replying. ',
    });

    expect(await history(raised.id)).toEqual([
      {
        kind: 'note',
        authorId: support.id,
        authorSide: 'staff',
        body: 'Probably the toner.\nCheck before replying.',
        bodyFormat: 'markdown',
      },
    ]);
    // Not the status, not the last activity, and not the first response.
    const after = await storedRequest(raised.id);
    expect(after?.status).toBe('waiting');
    expect(after?.lastActivityAt).toEqual(raisedAt);
    const detail = await getRequest(ctx, support, raised.id);
    expect(detail.firstResponseAt).toBeNull();
  });

  it('adds a note to a request that is done', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { status: 'done' });

    await addNote(ctx, support, { request: raised.id, body: 'Fixed by a new cable.' });

    expect(await history(raised.id)).toMatchObject([{ kind: 'note' }]);
    expect((await storedRequest(raised.id))?.status).toBe('done');
  });

  it.each([
    ['someone at the company who takes part', 'client'],
    ['a company Admin', 'admin'],
    ['a Watcher', 'watcher'],
  ] as const)('refuses %s', async (_name, role) => {
    const company = await createCompany(db);
    const member = await memberActor(db, company.id, role);
    const raised = await storeRequest(company.id);

    await expect(
      addNote(ctx, member, { request: raised.id, body: 'A note.' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await history(raised.id)).toEqual([]);
  });

  it('refuses Finance, who read notes but don’t write them', async () => {
    const company = await createCompany(db);
    const finance = await staffActor(db, 'finance');
    const raised = await storeRequest(company.id);

    await expect(
      addNote(ctx, finance, { request: raised.id, body: 'A note.' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a note on a request of a deactivated company', async () => {
    const company = await createCompany(db, { deactivated: true });
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await expect(
      addNote(ctx, support, { request: raised.id, body: 'A note.' }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.companyDeactivated' });
    expect(await history(raised.id)).toEqual([]);
  });

  it('refuses an empty note', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await expect(
      addNote(ctx, support, { request: raised.id, body: ' \r\n ' }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('counts towards the limit of texts one person writes', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await fillRateLimitBucket(
      db,
      `request-reply:user:${support.id}`,
      RATE_LIMITS.requestRepliesPerUser.limit,
    );

    await expect(
      addNote(ctx, support, { request: raised.id, body: 'One too many.' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('stores the people a note mentions, also someone at the company', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    const marker = writtenMentionMarker('Casey Client', mentionKey(company.id, client.id));

    await addNote(ctx, support, { request: raised.id, body: `Ask ${marker} first.` });

    const rows = await db
      .select()
      .from(requestMention)
      .where(eq(requestMention.requestId, raised.id));
    expect(rows).toMatchObject([{ userId: client.id, side: 'company' }]);
    const [note] = await history(raised.id);
    expect(note?.body).toBe(`Ask ${storedMentionMarker(rows[0]?.id ?? '')} first.`);
  });
});

describe('who a note subscribes', () => {
  /**
   * The IDs of the people subscribed to a request.
   *
   * @param raised - The request.
   * @param raised.id - Its ID.
   * @param raised.companyId - Its company.
   * @returns Their user IDs, sorted.
   */
  async function subscribers(raised: { id: string; companyId: string }) {
    return (await loadSubscribers(db, raised)).map(({ id }) => id).sort();
  }

  it('subscribes its author and the staff it mentions, never someone at the company', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    const staffMarker = writtenMentionMarker('Morgan Manager', mentionKey(company.id, manager.id));
    const clientMarker = writtenMentionMarker('Casey Client', mentionKey(company.id, client.id));

    await addNote(ctx, support, {
      request: raised.id,
      body: `${staffMarker}, can you check before we ask ${clientMarker}?`,
    });

    expect(await subscribers({ id: raised.id, companyId: company.id })).toEqual(
      [support.id, manager.id].sort(),
    );
  });

  it('subscribes nobody at the company when an edit of a note mentions them', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    await addNote(ctx, support, { request: raised.id, body: 'Probably the toner.' });
    const [note] = await db
      .select({ id: requestEntry.id })
      .from(requestEntry)
      .where(eq(requestEntry.requestId, raised.id));
    const marker = writtenMentionMarker('Casey Client', mentionKey(company.id, client.id));

    await editReply(ctx, support, {
      request: raised.id,
      entry: note?.id ?? '',
      text: `Probably the toner; ${marker} would know.`,
      edits: 0,
    });

    expect(await subscribers({ id: raised.id, companyId: company.id })).toEqual([support.id]);
  });
});

describe('internal notes for their readers', () => {
  it('gives notes to the staff and Finance, and never to the company', async () => {
    await createStaffSettings(db, 'Adiutor Tests');
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const finance = await staffActor(db, 'finance');
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    await storeEntry(raised.id, { authorId: client.id, body: 'Any news?' });
    await addNote(ctx, support, { request: raised.id, body: 'Probably the toner.' });

    /**
     * The kinds of entry a reader gets.
     *
     * @param reader - Who reads the request.
     * @returns The kinds, oldest first.
     */
    const kinds = async (reader: typeof client) =>
      (await getRequest(ctx, reader, raised.id)).entries.map(({ kind }) => kind);
    expect(await kinds(support)).toEqual(['comment', 'note']);
    expect(await kinds(finance)).toEqual(['comment', 'note']);
    expect(await kinds(client)).toEqual(['comment']);
    const forClient = await getRequest(ctx, client, raised.id);
    expect(JSON.stringify(forClient)).not.toContain('toner');
  });

  it('leaves notes out of what a company user can page back to', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    // More notes than a page of the conversation holds, then one reply.
    await Promise.all(
      Array.from({ length: THREAD_CHUNK + 5 }, (_, index) =>
        storeEntry(raised.id, {
          kind: 'note',
          authorId: support.id,
          authorSide: 'staff',
          body: `Note ${index}.`,
        }),
      ),
    );
    await storeEntry(raised.id, { authorId: client.id, body: 'Any news?' });

    const forClient = await getRequest(ctx, client, raised.id, { earlier: 3 });
    expect(forClient.entries.map(({ kind }) => kind)).toEqual(['comment']);
    expect(forClient.earlierEntries).toBe(0);
    const forStaff = await getRequest(ctx, support, raised.id);
    expect(forStaff.earlierEntries).toBe(6);
  });

  it('lets its author edit a note while the request is open, and nobody else', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const raised = await storeRequest(company.id);
    await addNote(ctx, support, { request: raised.id, body: 'Probably the toner.' });
    const [note] = await db
      .select({ id: requestEntry.id })
      .from(requestEntry)
      .where(eq(requestEntry.requestId, raised.id));
    const entry = note?.id ?? '';

    const forAuthor = await getRequest(ctx, support, raised.id);
    expect(forAuthor.entries[0]?.body?.edit).toEqual({ markdown: 'Probably the toner.', edits: 0 });
    expect((await getRequest(ctx, manager, raised.id)).entries[0]?.body?.edit).toBeUndefined();

    await expect(
      editReply(ctx, manager, { request: raised.id, entry, text: 'Mine now.', edits: 0 }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      await editReply(ctx, support, {
        request: raised.id,
        entry,
        text: 'The toner, ordered.',
        edits: 0,
      }),
    ).toEqual({ changed: true });
    const edited = (await getRequest(ctx, manager, raised.id)).entries[0]?.body;
    expect(edited?.text).toBe('The toner, ordered.');
    expect(edited?.versions?.map(({ text }) => text)).toEqual(['Probably the toner.']);
  });

  it('doesn’t make a staff member who only wrote a note one the company can mention', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    await addNote(ctx, support, { request: raised.id, body: 'Probably the toner.' });

    const mentionable = await listMentionable(ctx, client, { request: raised.id });
    expect(mentionable.filter(({ staff }) => staff)).toEqual([]);
  });
});

describe('addNote: links to the staff’s pages', () => {
  it('keeps a link to a page for the staff, which a reply keeps as its text', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    const body = `Ask [Sam Support](${appUrl}/admin/users/${support.id}) about the toner.`;

    await addNote(ctx, support, { request: raised.id, body });

    expect((await history(raised.id))[0]?.body).toBe(body);
  });
});
