/**
 * @file Integration tests for what one person's email about a request may
 * show when it's sent. Who is told is tested in `tell-people.int.test.ts`,
 * sending itself with the job
 * (`src/server/jobs/queued/request-updates.int.test.ts`).
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  membership,
  queuedJob,
  requestAttachment,
  requestEntry,
  requestMention,
  requestParticipant,
  user,
} from '@/db/schema';
import { writtenMentionMarker } from '@/lib/requests';

import {
  createCompany,
  createStaffSettings,
  memberActor,
  staffActor,
  storeAttachment,
} from '../../../tests/integration/helpers';
import { changeAssignees } from './assignees';
import { editRequestDescription } from './edits';
import mentionKey from './mention-key';
import addNote from './notes';
import raiseRequest from './raise';
import { readRequestUpdate } from './read-request-update';
import replyToRequest from './reply';
import type { QueuedRequestNews } from './request-update';
import { changeSubscribers, unsubscribe } from './subscribers';
import { ctx, db, storage, storeEntry, storeRequest, storeSubscribers } from './test-helpers';

/**
 * The queued news for one person, as the batch hands it over.
 *
 * @param userId - The person.
 * @returns Their news.
 */
async function newsFor(userId: string): Promise<QueuedRequestNews[]> {
  const jobs = await db
    .select({ id: queuedJob.id, payload: queuedJob.payload })
    .from(queuedJob)
    .where(eq(queuedJob.kind, 'request-update'));
  return jobs.flatMap(({ id, payload }) => {
    const news = payload as { userId: string } & Omit<QueuedRequestNews, 'jobId'>;
    return news.userId === userId
      ? [{ jobId: id, event: news.event, entryId: news.entryId, byUserId: news.byUserId }]
      : [];
  });
}

describe('what one person’s email may show', () => {
  it('tells what happened in order, with names, the reply and its mentions', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db, { name: 'Adiutor Tests Client' });
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await storeRequest(company.id, { title: 'The printer is broken' });
    await storeSubscribers(raised.id, [watcher.id, support.id]);
    // The reply mentions a colleague: the reader gets it as a reply, with that colleague's name.
    const colleague = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const toCasey = writtenMentionMarker('casey', mentionKey(company.id, colleague.id));
    await replyToRequest(ctx, support, {
      request: raised.id,
      body: `Which one? ${toCasey} knows.`,
      status: 'waiting',
    });

    const queued = await newsFor(watcher.id);
    const update = await readRequestUpdate(
      ctx,
      { requestId: raised.id, userId: watcher.id },
      queued,
    );

    expect(update).toMatchObject({
      // The email opens the request at the reply, the first news it tells of.
      anchor: `entry-${queued.find(({ event }) => event === 'reply')?.entryId}`,
      recipient: { email: 'wim@adiutor.test', locale: null },
      role: 'subscriber',
      audience: 'follower',
      request: {
        number: raised.number,
        reference: `AD-${raised.number}`,
        title: 'The printer is broken',
        companyName: 'Adiutor Tests Client',
      },
      skipped: [],
    });
    expect(update?.items).toHaveLength(2);
    const [reply, status] = update?.items ?? [];
    expect(reply).toMatchObject({ event: 'reply', by: 'sam' });
    expect(status).toEqual({
      event: 'status',
      by: 'sam',
      bySide: 'staff',
      from: 'open',
      to: 'waiting',
    });
    // The reply as it's stored, with who its marker names: by name, as the page shows them.
    const text = reply?.event === 'reply' ? reply.text : undefined;
    expect(text?.format).toBe('markdown');
    expect(Object.values(text?.mentions ?? {})).toEqual(['casey']);
    expect(text?.text).toContain(`(mention:${Object.keys(text?.mentions ?? {})[0]})`);
    // Names only: no address, and no ID of a person.
    const shown = JSON.stringify(update?.items);
    expect(shown).not.toContain('@adiutor.test');
    expect(shown).not.toContain(support.id);
    expect(shown).not.toContain(colleague.id);
  });

  it('names a reply’s files as they are when the email is sent, and nothing more of them', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const watcher = await memberActor(db, company.id, 'watcher');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [watcher.id, support.id]);
    const files = [
      await storeAttachment(db, storage, { uploadedBy: support.id, name: 'test-page.pdf' }),
      await storeAttachment(db, storage, { uploadedBy: support.id, name: 'password.png' }),
    ];
    await replyToRequest(ctx, support, {
      request: raised.id,
      body: 'The test page is attached.',
      attachments: files,
    });
    // Removed before the email went: it isn't named.
    await db
      .update(requestAttachment)
      .set({ removedAt: new Date(), removedBy: support.id })
      .where(eq(requestAttachment.id, files[1] ?? ''));

    const update = await readRequestUpdate(
      ctx,
      { requestId: raised.id, userId: watcher.id },
      await newsFor(watcher.id),
    );

    const [reply] = update?.items ?? [];
    expect(reply?.event === 'reply' ? reply.text.attachments : undefined).toEqual([
      { name: 'test-page.pdf', size: 15 },
    ]);
    // Its name and size only: no ID to download it by, and nothing of who uploaded it.
    expect(JSON.stringify(update?.items)).not.toContain(files[0] ?? '');
  });

  it('says why they get it and words it for them: an assignee on the staff', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await changeAssignees(ctx, support, { request: raised.id, add: [support.id], remove: [] });
    await replyToRequest(ctx, client, { request: raised.id, body: 'Any news?' });

    const update = await readRequestUpdate(
      ctx,
      { requestId: raised.id, userId: support.id },
      await newsFor(support.id),
    );

    expect(update).toMatchObject({ role: 'assignee', audience: 'staff' });
  });

  it('names someone without a name, or whose account is gone, by their side', async () => {
    await createStaffSettings(db, 'Adiutor Tests Desk');
    const company = await createCompany(db, { name: 'Adiutor Tests Client' });
    const watcher = await memberActor(db, company.id, 'watcher');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [watcher.id]);
    const byStaff = await storeEntry(raised.id, { authorSide: 'staff', body: 'From the staff.' });
    const byCompany = await storeEntry(raised.id, { authorSide: 'company', body: 'From us.' });

    const update = await readRequestUpdate(ctx, { requestId: raised.id, userId: watcher.id }, [
      { jobId: 'job-1', event: 'reply', entryId: byStaff.id, byUserId: null },
      { jobId: 'job-2', event: 'reply', entryId: byCompany.id, byUserId: null },
    ]);

    expect(update?.items.map(({ by }) => by)).toEqual([
      'Adiutor Tests Desk',
      'Adiutor Tests Client',
    ]);
  });

  it('gives nothing to someone who unsubscribed, lost access or was deactivated meanwhile', async () => {
    const company = await createCompany(db);
    const unsubscribed = await memberActor(db, company.id, 'client');
    const left = await memberActor(db, company.id, 'client');
    const closed = await memberActor(db, company.id, 'client');
    const stays = await memberActor(db, company.id, 'watcher');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [unsubscribed.id, left.id, closed.id, stays.id]);
    await replyToRequest(ctx, support, { request: raised.id, body: 'We’re on it.' });
    /**
     * Reads the email of one of them.
     *
     * @param userId - Whose.
     * @returns What it may show.
     */
    const read = async (userId: string) =>
      readRequestUpdate(ctx, { requestId: raised.id, userId }, await newsFor(userId));
    expect(await read(stays.id)).not.toBeNull();

    await unsubscribe(ctx, unsubscribed, { request: raised.id });
    await db.delete(membership).where(eq(membership.userId, left.id));
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, closed.id));

    expect(await read(unsubscribed.id)).toBeNull();
    expect(await read(left.id)).toBeNull();
    expect(await read(closed.id)).toBeNull();
    expect(await read(stays.id)).not.toBeNull();
  });

  it('leaves out news whose entry is gone, and tells the same news once', async () => {
    const company = await createCompany(db);
    const watcher = await memberActor(db, company.id, 'watcher');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [watcher.id]);
    const kept = await storeEntry(raised.id, { body: 'Still here.' });
    const gone = await storeEntry(raised.id, { body: 'Gone.' });
    await db.delete(requestEntry).where(eq(requestEntry.id, gone.id));

    const update = await readRequestUpdate(ctx, { requestId: raised.id, userId: watcher.id }, [
      { jobId: 'job-1', event: 'reply', entryId: kept.id, byUserId: null },
      { jobId: 'job-2', event: 'reply', entryId: gone.id, byUserId: null },
      // The same news twice, as a job that ran but couldn't be noted as done leaves it.
      { jobId: 'job-3', event: 'reply', entryId: kept.id, byUserId: null },
      // News that doesn't fit its entry: a reply is no status change.
      { jobId: 'job-4', event: 'status', entryId: kept.id, byUserId: null },
    ]);

    expect(update?.items).toHaveLength(1);
    expect(update?.skipped).toEqual(['job-2', 'job-4']);
  });

  it('gives nothing when none of the news is left, or the request is gone', async () => {
    const company = await createCompany(db);
    const watcher = await memberActor(db, company.id, 'watcher');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [watcher.id]);
    const other = await storeRequest(company.id);
    const elsewhere = await storeEntry(other.id);

    // An entry of another request isn't this request's news.
    expect(
      await readRequestUpdate(ctx, { requestId: raised.id, userId: watcher.id }, [
        { jobId: 'job-1', event: 'reply', entryId: elsewhere.id, byUserId: null },
      ]),
    ).toBeNull();
    expect(
      await readRequestUpdate(
        ctx,
        { requestId: '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b', userId: watcher.id },
        [{ jobId: 'job-1', event: 'reply', entryId: elsewhere.id, byUserId: null }],
      ),
    ).toBeNull();
  });

  it('keeps telling an assignee who unsubscribed: the request is still theirs', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await changeAssignees(ctx, support, { request: raised.id, add: [support.id], remove: [] });
    await replyToRequest(ctx, client, { request: raised.id, body: 'Any news?' });
    await db
      .delete(requestParticipant)
      .where(
        and(eq(requestParticipant.userId, support.id), eq(requestParticipant.role, 'subscriber')),
      );

    const update = await readRequestUpdate(
      ctx,
      { requestId: raised.id, userId: support.id },
      await newsFor(support.id),
    );

    expect(update?.role).toBe('assignee');
  });

  it('tells a reply that mentions the reader once, as the mention', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [client.id]);
    await replyToRequest(ctx, support, {
      request: raised.id,
      body: `Which one, ${writtenMentionMarker('casey', mentionKey(company.id, client.id))}?`,
    });
    const [reply] = await db.select({ id: requestEntry.id }).from(requestEntry);
    const queued = await newsFor(client.id);

    const update = await readRequestUpdate(ctx, { requestId: raised.id, userId: client.id }, [
      ...queued,
      // The reply itself, as if it had been queued for them too.
      { jobId: 'zzz', event: 'reply', entryId: reply?.id ?? '', byUserId: null },
    ]);

    expect(update?.items).toHaveLength(1);
    expect(update?.items[0]).toMatchObject({ event: 'mentioned', by: 'sam', where: 'reply' });
    expect(update?.skipped).toEqual([]);
  });

  it('shows the description to someone it mentions, until an edit takes the mention out', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin', 'anna@adiutor.test');
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const raised = await raiseRequest(ctx, admin, {
      companyId: company.id,
      title: 'The printer is broken',
      description: `${writtenMentionMarker('wim', mentionKey(company.id, watcher.id))} saw it first.`,
      type: 'bug',
    });
    const queued = await newsFor(watcher.id);

    const update = await readRequestUpdate(
      ctx,
      { requestId: raised.id, userId: watcher.id },
      queued,
    );

    const [item] = update?.items ?? [];
    expect(item).toMatchObject({ event: 'mentioned', by: 'anna', where: 'description' });
    // The email opens the request at its description.
    expect(update?.anchor).toBe('request-description');
    const text = item?.event === 'mentioned' ? item.text : undefined;
    expect(text?.text).toContain('saw it first.');
    expect(Object.values(text?.mentions ?? {})).toEqual(['wim']);

    await editRequestDescription(ctx, admin, {
      request: raised.id,
      text: 'Someone saw it first.',
      edits: 0,
    });

    // No longer true, and the only news they had: no email.
    expect(
      await readRequestUpdate(ctx, { requestId: raised.id, userId: watcher.id }, queued),
    ).toBeNull();
  });

  it('opens a company reader’s email at the reply, never at a note before it', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const manager = await staffActor(db, 'manager', 'mo@adiutor.test');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [client.id, manager.id]);
    await addNote(ctx, support, { request: raised.id, body: 'The toner is empty.' });
    await replyToRequest(ctx, support, { request: raised.id, body: 'We are on it.' });
    /**
     * Reads someone's email, with the anchor its news should give.
     *
     * @param userId - The reader.
     * @param event - The news whose entry the email should open at.
     * @returns The anchor it has, and the one expected.
     */
    const anchors = async (userId: string, event: string) => {
      const queued = await newsFor(userId);
      const update = await readRequestUpdate(ctx, { requestId: raised.id, userId }, queued);
      const expected = queued.find((news) => news.event === event)?.entryId;
      return { anchor: update?.anchor, expected: `entry-${expected}` };
    };

    // The staff member's email opens at the note, the first news it tells of.
    const toManager = await anchors(manager.id, 'note');
    expect(toManager.anchor).toBe(toManager.expected);
    // The client's email never tells of the note, so it opens at the reply.
    const toClient = await anchors(client.id, 'reply');
    expect(toClient.anchor).toBe(toClient.expected);
  });

  it('says who assigned it to them, unless it was taken back since', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const manager = await staffActor(db, 'manager', 'mo@adiutor.test');
    const raised = await storeRequest(company.id);
    await changeAssignees(ctx, support, { request: raised.id, add: [manager.id], remove: [] });
    const queued = await newsFor(manager.id);
    /**
     * Reads the manager's email.
     *
     * @returns What it may show.
     */
    const read = () => readRequestUpdate(ctx, { requestId: raised.id, userId: manager.id }, queued);

    expect(await read()).toMatchObject({
      role: 'assignee',
      items: [{ event: 'assigned', by: 'sam' }],
    });

    await changeAssignees(ctx, support, { request: raised.id, add: [], remove: [manager.id] });

    expect(await read()).toBeNull();
  });

  it('says who subscribed them, by the name the request gives that person', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin', 'anna@adiutor.test');
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const raised = await storeRequest(company.id);
    await changeSubscribers(ctx, admin, {
      request: raised.id,
      add: [mentionKey(company.id, watcher.id)],
      remove: [],
    });
    const queued = await newsFor(watcher.id);

    const update = await readRequestUpdate(
      ctx,
      { requestId: raised.id, userId: watcher.id },
      queued,
    );

    expect(update).toMatchObject({
      role: 'subscriber',
      items: [{ event: 'subscribed', by: 'anna' }],
      // Being subscribed leaves no entry: the email opens the request at the top.
      anchor: null,
    });
    // Never the ID of whoever did it.
    expect(JSON.stringify(update?.items)).not.toContain(admin.id);
  });

  it('tells someone a request was raised for who raised it, with its description', async () => {
    await createStaffSettings(db, 'Adiutor Tests');
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await raiseRequest(ctx, support, {
      companyId: company.id,
      title: 'The printer is broken',
      description: 'It prints blank pages, they said on the phone.',
      type: 'bug',
      raisedFor: mentionKey(company.id, client.id),
    });
    /**
     * Reads the Client's email as it would be sent now.
     *
     * @returns What it may show.
     */
    const read = async () =>
      readRequestUpdate(ctx, { requestId: raised.id, userId: client.id }, await newsFor(client.id));

    expect(await read()).toMatchObject({
      role: 'subscriber',
      items: [
        {
          event: 'raised',
          by: 'sam',
          text: { text: 'It prints blank pages, they said on the phone.', format: 'markdown' },
        },
      ],
      // The email opens the request at its description.
      anchor: 'request-description',
    });
    expect(JSON.stringify((await read())?.items)).not.toContain(support.id);

    // The request still says a staff member raised it once their account is gone.
    await db.delete(user).where(eq(user.id, support.id));
    expect((await read())?.items).toMatchObject([{ event: 'raised', by: 'Adiutor Tests' }]);
  });

  it('gives nothing to someone who turned emails about requests off, assigned or not', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await changeAssignees(ctx, support, { request: raised.id, add: [support.id], remove: [] });
    await replyToRequest(ctx, client, { request: raised.id, body: 'Any news?' });
    const queued = await newsFor(support.id);
    expect(
      await readRequestUpdate(ctx, { requestId: raised.id, userId: support.id }, queued),
    ).not.toBeNull();

    await db.update(user).set({ requestEmails: false }).where(eq(user.id, support.id));

    expect(
      await readRequestUpdate(ctx, { requestId: raised.id, userId: support.id }, queued),
    ).toBeNull();
  });

  it('shows a note and a reply of the same few minutes in one email to the staff', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const manager = await staffActor(db, 'manager', 'morgan@adiutor.test');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [client.id, manager.id]);
    await addNote(ctx, support, { request: raised.id, body: 'The toner is empty.' });
    await replyToRequest(ctx, support, { request: raised.id, body: 'We are on it.' });

    const update = await readRequestUpdate(
      ctx,
      { requestId: raised.id, userId: manager.id },
      await newsFor(manager.id),
    );

    expect(update?.items).toMatchObject([
      { event: 'note', by: 'sam', text: { text: 'The toner is empty.' } },
      { event: 'reply', by: 'sam', text: { text: 'We are on it.' } },
    ]);
    // The client only hears of the reply.
    const forClient = await readRequestUpdate(
      ctx,
      { requestId: raised.id, userId: client.id },
      await newsFor(client.id),
    );
    expect(forClient?.items.map(({ event }) => event)).toEqual(['reply']);
  });

  it('leaves a note out for anyone at the company, whatever queued it', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [client.id]);
    const note = await storeEntry(raised.id, { kind: 'note', body: 'Between us.' });
    // A note that mentions them, so the mention would be told to anyone allowed to read it.
    await db
      .insert(requestMention)
      .values({ requestId: raised.id, entryId: note.id, userId: client.id, side: 'company' });
    // News about the note, as a mistake elsewhere might queue it for the client.
    const news = ['note', 'mentioned'].map((event, index) => ({
      jobId: `0000000${index}`,
      event: event as QueuedRequestNews['event'],
      entryId: note.id,
      byUserId: support.id,
    }));

    expect(await readRequestUpdate(ctx, { requestId: raised.id, userId: client.id }, news)).toBe(
      null,
    );
  });
});
