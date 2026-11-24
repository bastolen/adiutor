/**
 * @file Integration tests for editing a request's description and its
 * replies: who may edit what and when, what an edit keeps (a version for the
 * staff, the time it was edited, the text's mentions), and an edit someone
 * made meanwhile. Which roles may edit is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { request, requestEntry, requestMention, requestTextVersion, user } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { appUrl } from '@/lib/env';
import { storedMentionMarker, writtenMentionMarker } from '@/lib/requests';

import {
  createCompany,
  memberActor,
  minutesAgo,
  staffActor,
  inSequence,
} from '../../../tests/integration/helpers';
import { getRequest } from './detail';
import { editReply, editRequestDescription } from './edits';
import mentionKey from './mention-key';
import { ctx, db, storeEntry, storeRequest, storedRequest } from './test-helpers';

/**
 * The versions of a request's texts, as stored, oldest first.
 *
 * @param requestId - The request.
 * @returns Each version as `[entry, text, editor's side]`.
 */
async function versionsOf(requestId: string) {
  const rows = await db
    .select()
    .from(requestTextVersion)
    .where(eq(requestTextVersion.requestId, requestId))
    .orderBy(requestTextVersion.id);
  return rows.map(({ entryId, body, editedBySide }) => [entryId, body, editedBySide]);
}

describe('editRequestDescription', () => {
  it('lets someone at the company who takes part edit it, keeping the earlier text as a version', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const activity = minutesAgo(60);
    const raised = await storeRequest(company.id, {
      description: 'It prints blank pages.',
      lastActivityAt: activity,
    });

    const result = await editRequestDescription(ctx, client, {
      request: String(raised.number),
      text: 'It prints blank pages since Monday.',
      edits: 0,
    });

    expect(result).toEqual({ changed: true });
    const stored = await storedRequest(raised.id);
    expect(stored?.description).toBe('It prints blank pages since Monday.');
    expect(stored?.descriptionFormat).toBe('markdown');
    expect(stored?.descriptionEditedAt).toBeInstanceOf(Date);
    // A correction, not news: the request keeps its place in the lists.
    expect(stored?.lastActivityAt).toEqual(activity);
    expect(await versionsOf(raised.id)).toEqual([[null, 'It prints blank pages.', 'company']]);
  });

  it('lets the staff who work on requests edit it', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await editRequestDescription(ctx, support, { request: raised.id, text: 'Clearer.', edits: 0 });

    expect((await storedRequest(raised.id))?.description).toBe('Clearer.');
    expect((await versionsOf(raised.id))[0]?.[2]).toBe('staff');
  });

  it.each([
    ['a Watcher', async (companyId: string) => memberActor(db, companyId, 'watcher')],
    ['Finance', async () => staffActor(db, 'finance')],
  ])('refuses %s, who only read', async (_who, reader) => {
    const company = await createCompany(db);
    const raised = await storeRequest(company.id);

    await expect(
      editRequestDescription(ctx, await reader(company.id), {
        request: raised.id,
        text: 'Mine now.',
        edits: 0,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an edit once the request is closed, and on a deactivated company', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const done = await storeRequest(company.id, { status: 'done' });
    const deactivated = await createCompany(db, { deactivated: true });
    const frozen = await storeRequest(deactivated.id);

    await expect(
      editRequestDescription(ctx, support, { request: done.id, text: 'Too late.', edits: 0 }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.requests.closedNoEdit' });
    await expect(
      editRequestDescription(ctx, support, { request: frozen.id, text: 'No.', edits: 0 }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.companyDeactivated' });
    expect(await versionsOf(done.id)).toEqual([]);
  });

  it('saves nothing for an unchanged text', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id, { description: 'Same.' });

    expect(
      await editRequestDescription(ctx, client, { request: raised.id, text: 'Same.', edits: 0 }),
    ).toEqual({ changed: false });
    expect(await versionsOf(raised.id)).toEqual([]);
    expect((await storedRequest(raised.id))?.descriptionEditedAt).toBeNull();
  });

  it('refuses an edit of a text someone edited meanwhile, rather than overwrite it', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await editRequestDescription(ctx, support, { request: raised.id, text: 'Staff’s.', edits: 0 });

    // The client's page still showed the text as it was, before the staff's edit.
    await expect(
      editRequestDescription(ctx, client, { request: raised.id, text: 'Client’s.', edits: 0 }),
    ).rejects.toMatchObject({ code: 'conflict', key: 'errors.requests.textChanged' });
    expect((await storedRequest(raised.id))?.description).toBe('Staff’s.');
  });

  it('gives the editor the text’s mentions to keep, stores them afresh, and keeps names in the version', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const colleague = await memberActor(db, company.id, 'client');
    await db.update(user).set({ name: 'Casey Colleague' }).where(eq(user.id, colleague.id));
    const raised = await storeRequest(company.id);
    const mention = firstRow(
      await db
        .insert(requestMention)
        .values({ requestId: raised.id, userId: colleague.id, side: 'company' })
        .returning({ id: requestMention.id }),
      'the mention',
    );
    await db
      .update(request)
      .set({ description: `Ask ${storedMentionMarker(mention.id)}.` })
      .where(eq(request.id, raised.id));

    const { description } = await getRequest(ctx, client, raised.id);
    const marker = writtenMentionMarker('Casey Colleague', mentionKey(company.id, colleague.id));
    expect(description.edit).toEqual({ markdown: `Ask ${marker}.`, edits: 0 });

    await editRequestDescription(ctx, client, {
      request: raised.id,
      text: `Ask ${marker} today.`,
      edits: 0,
    });

    const rows = await db
      .select()
      .from(requestMention)
      .where(eq(requestMention.requestId, raised.id));
    expect(rows.map(({ userId }) => userId)).toEqual([colleague.id]);
    expect(rows[0]?.id).not.toBe(mention.id);
    expect((await storedRequest(raised.id))?.description).toBe(
      `Ask ${storedMentionMarker(rows[0]?.id ?? '')} today.`,
    );
    expect(await versionsOf(raised.id)).toEqual([[null, 'Ask @Casey Colleague.', 'company']]);
  });
});

describe('editReply', () => {
  it('lets the one who wrote a reply edit it', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    const reply = await storeEntry(raised.id, {
      authorId: support.id,
      authorSide: 'staff',
      body: 'On it.',
    });

    expect(
      await editReply(ctx, support, {
        request: raised.id,
        entry: reply.id,
        text: 'On it: back tomorrow.',
        edits: 0,
      }),
    ).toEqual({ changed: true });
    const [stored] = await db.select().from(requestEntry).where(eq(requestEntry.id, reply.id));
    expect(stored?.body).toBe('On it: back tomorrow.');
    expect(stored?.editedAt).toBeInstanceOf(Date);
    expect(await versionsOf(raised.id)).toEqual([[reply.id, 'On it.', 'staff']]);
  });

  it('reports someone else’s reply, and an entry that isn’t one, as not found', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    const theirs = await storeEntry(raised.id, { authorId: client.id, body: 'Any news?' });
    const change = await storeEntry(raised.id, {
      kind: 'status',
      authorId: support.id,
      authorSide: 'staff',
      fromValue: 'open',
      toValue: 'todo',
    });

    // One refusal after another, on one request.
    await inSequence([theirs.id, change.id, 'not-an-id'], async (entry) => {
      await expect(
        editReply(ctx, support, { request: raised.id, entry, text: 'Mine now.', edits: 0 }),
      ).rejects.toMatchObject({ code: 'not_found' });
    });
  });
});

describe('editing: links to the staff’s pages', () => {
  it('keeps a link to a page for the staff as its text in a description and a reply', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    const reply = await storeEntry(raised.id, {
      authorId: support.id,
      authorSide: 'staff',
      body: 'On it.',
    });
    const userPage = `${appUrl}/admin/users/${support.id}`;

    await editRequestDescription(ctx, support, {
      request: raised.id,
      text: `It prints blank pages, says [Sam Support](${userPage}).`,
      edits: 0,
    });
    await editReply(ctx, support, {
      request: raised.id,
      entry: reply.id,
      text: `On it, with [Sam Support](${userPage}).`,
      edits: 0,
    });

    expect((await storedRequest(raised.id))?.description).toBe(
      'It prints blank pages, says Sam Support.',
    );
    const [stored] = await db.select().from(requestEntry).where(eq(requestEntry.id, reply.id));
    expect(stored?.body).toBe('On it, with Sam Support.');
  });

  it('keeps such a link in an internal note, which only the staff read', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    const note = await storeEntry(raised.id, {
      kind: 'note',
      authorId: support.id,
      authorSide: 'staff',
      body: 'Ask Sam.',
    });
    const text = `Ask [Sam Support](${appUrl}/admin/users/${support.id}).`;

    await editReply(ctx, support, { request: raised.id, entry: note.id, text, edits: 0 });

    const [stored] = await db.select().from(requestEntry).where(eq(requestEntry.id, note.id));
    expect(stored?.body).toBe(text);
  });

  it('gives the company a text to edit without links saved before, and the staff the text as it is', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const userPage = `${appUrl}/admin/users/${support.id}`;
    // Saved before links to the staff's pages were kept out of texts.
    const description = `Ask [Sam Support](${userPage}), see [the docs](https://adiutor.dev/docs).`;
    const raised = await storeRequest(company.id, { description, descriptionFormat: 'markdown' });
    // One too costly to read as Markdown, by the Client.
    const runs = '*a '.repeat(2600);
    const costly = `${runs}Ask [Sam Support](<${userPage}> "Sam").`;
    const reply = await storeEntry(raised.id, {
      authorId: client.id,
      body: costly,
      bodyFormat: 'markdown',
    });

    const forClient = await getRequest(ctx, client, raised.id);
    const forStaff = await getRequest(ctx, support, raised.id);

    expect(forClient.description.edit?.markdown).toBe(
      'Ask Sam Support, see [the docs](https://adiutor.dev/docs).',
    );
    expect(forClient.entries.find(({ id }) => id === reply.id)?.body?.edit?.markdown).toBe(
      `${runs}Ask Sam Support.`,
    );
    expect(forStaff.description.edit?.markdown).toBe(description);
  });

  it('gives the company a text to edit without a link whose host is written another way', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    // Adiutor's host with its first letter percent-encoded: the text never names it as it is.
    const { protocol, hostname, port } = new URL(appUrl);
    const host = `%${hostname.charCodeAt(0).toString(16)}${hostname.slice(1)}${port ? `:${port}` : ''}`;
    const description = `Ask [Sam Support](${protocol}//${host}/admin/users/${support.id}).`;
    const raised = await storeRequest(company.id, { description, descriptionFormat: 'markdown' });

    const forClient = await getRequest(ctx, client, raised.id);

    expect(forClient.description.edit?.markdown).toBe('Ask Sam Support.');
  });

  it('costs a company’s reader little more to read than the staff, however links nest', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    // Links nested in links, which each time the text is read as Markdown takes out one level of.
    const description = `${'['.repeat(300)}x${`](${appUrl}/admin)`.repeat(300)}`;
    const raised = await storeRequest(company.id, { description, descriptionFormat: 'markdown' });
    await getRequest(ctx, support, raised.id);

    let started = performance.now();
    await getRequest(ctx, support, raised.id);
    const forStaff = performance.now() - started;
    started = performance.now();
    const forClient = await getRequest(ctx, client, raised.id);
    const took = performance.now() - started;

    expect(forClient.description.edit?.markdown).not.toContain('/admin');
    // Read as Markdown twice, then by the rule that reads none: milliseconds, not ten readings.
    expect(took - forStaff).toBeLessThan(250);
  });
});

describe('getRequest: edited texts', () => {
  it('says when a text was edited, gives its versions to the staff only, and its editor what to start from', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const watcher = await memberActor(db, company.id, 'watcher');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { description: 'First.' });
    const reply = await storeEntry(raised.id, { authorId: client.id, body: 'A reply.' });
    await editRequestDescription(ctx, client, { request: raised.id, text: 'Second.', edits: 0 });

    const forStaff = await getRequest(ctx, support, raised.id);
    const forClient = await getRequest(ctx, client, raised.id);
    const forWatcher = await getRequest(ctx, watcher, raised.id);

    expect(forStaff.description.editedAt).toBeInstanceOf(Date);
    expect(forStaff.description.versions?.map(({ text }) => text)).toEqual(['First.']);
    expect(forClient.description.versions).toBeUndefined();
    expect(forClient.description.edit).toEqual({ markdown: 'Second.', edits: 1 });
    expect(forWatcher.description.edit).toBeUndefined();
    // Only the one who wrote a reply gets to edit it.
    expect(forClient.entries.find(({ id }) => id === reply.id)?.body?.edit).toEqual({
      markdown: 'A reply.',
      edits: 0,
    });
    expect(forStaff.entries.find(({ id }) => id === reply.id)?.body?.edit).toBeUndefined();
  });
});
