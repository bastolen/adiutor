/**
 * @file Integration tests for the news about a request: who a reply and a
 * status change are queued for, and what one person's email about them may
 * show when it's sent. Sending itself is tested with the job
 * (`src/server/jobs/queued/request-updates.int.test.ts`).
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { membership, queuedJob, requestEntry, requestParticipant, user } from '@/db/schema';
import { writtenMentionMarker } from '@/lib/requests';

import {
  createCompany,
  createStaffSettings,
  memberActor,
  staffActor,
} from '../../../tests/integration/helpers';
import { changeAssignees } from './assignees';
import { editReply, editRequestDescription } from './edits';
import mentionKey from './mention-key';
import addNote from './notes';
import raiseRequest from './raise';
import replyToRequest from './reply';
import changeRequestStatus from './status';
import { changeSubscribers, subscribe, unsubscribe } from './subscribers';
import { ctx, db, storeEntry, storeRequest } from './test-helpers';
import { type QueuedRequestNews, readRequestUpdate } from './updates';

/**
 * Subscribes people to a request without going through a service.
 *
 * @param requestId - The request.
 * @param userIds - The people.
 */
async function storeSubscribers(requestId: string, userIds: readonly string[]): Promise<void> {
  await db
    .insert(requestParticipant)
    .values(userIds.map((userId) => ({ requestId, userId, role: 'subscriber' as const })));
}

/**
 * The news that waits in the queue, as `<person>:<event>`, sorted.
 *
 * @param people - The people the test knows, by the name it gives them.
 * @returns What is queued for whom.
 */
async function queuedFor(people: Record<string, { id: string }>): Promise<string[]> {
  const nameOf = new Map(Object.entries(people).map(([name, { id }]) => [id, name]));
  const jobs = await db
    .select({ payload: queuedJob.payload, batchKey: queuedJob.batchKey })
    .from(queuedJob)
    .where(eq(queuedJob.kind, 'request-update'));
  return jobs
    .map(({ payload }) => {
      const { userId, event } = payload as { userId: string; event: string };
      return `${nameOf.get(userId) ?? userId}:${event}`;
    })
    .sort();
}

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

describe('who is told', () => {
  it('queues a reply for everyone on the request but its writer', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const watcher = await memberActor(db, company.id, 'watcher');
    const finance = await staffActor(db, 'finance');
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const bystander = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [client.id, watcher.id, finance.id]);
    await changeAssignees(ctx, manager, { request: raised.id, add: [manager.id], remove: [] });

    await replyToRequest(ctx, support, { request: raised.id, body: 'We’re on it.' });

    // The writer follows the request from now on, and isn't told what they wrote themselves.
    expect(await queuedFor({ client, watcher, finance, support, manager, bystander })).toEqual([
      'client:reply',
      'finance:reply',
      'manager:reply',
      'watcher:reply',
    ]);
  });

  it('queues a reply and the status change it brings together, for one email', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { status: 'waiting' });
    await storeSubscribers(raised.id, [support.id]);

    await replyToRequest(ctx, client, { request: raised.id, body: 'It’s the one on floor 2.' });

    expect(await queuedFor({ client, support })).toEqual(['support:reply', 'support:status']);
    const keys = await db.select({ batchKey: queuedJob.batchKey }).from(queuedJob);
    expect(new Set(keys.map(({ batchKey }) => batchKey))).toEqual(
      new Set([`request-updates:${raised.id}:${support.id}`]),
    );
  });

  it('queues a status change for everyone else, and nothing when the status stays', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [client.id, support.id]);

    await changeRequestStatus(ctx, support, { request: raised.id, status: 'in_progress' });
    await changeRequestStatus(ctx, support, { request: raised.id, status: 'in_progress' });

    expect(await queuedFor({ client, support })).toEqual(['client:status']);
  });

  it('tells someone a reply mentions, who is on the request from then on', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await replyToRequest(ctx, support, {
      request: raised.id,
      body: `Which one, ${writtenMentionMarker('casey', mentionKey(company.id, client.id))}?`,
    });

    // Told once, as the mention: the reply is what mentions them.
    expect(await queuedFor({ client, support })).toEqual(['client:mentioned']);
  });

  it('queues nothing when nobody else is on the request', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await replyToRequest(ctx, support, { request: raised.id, body: 'Anyone there?' });
    await changeRequestStatus(ctx, support, { request: raised.id, status: 'done' });

    expect(await queuedFor({ support })).toEqual([]);
  });

  it('tells nobody who can no longer read the request, or whose account is deactivated', async () => {
    const company = await createCompany(db);
    const left = await memberActor(db, company.id, 'client');
    const closed = await memberActor(db, company.id, 'client');
    const stays = await memberActor(db, company.id, 'watcher');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    // Rows as losing access at the very moment of being subscribed would leave them.
    await storeSubscribers(raised.id, [left.id, closed.id, stays.id]);
    await db.delete(membership).where(eq(membership.userId, left.id));
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, closed.id));

    await replyToRequest(ctx, support, { request: raised.id, body: 'We’re on it.' });

    expect(await queuedFor({ left, closed, stays, support })).toEqual(['stays:reply']);
  });
});

describe('who is told they were put on a request', () => {
  it('tells a staff member a colleague assigned it to, not one who took it themselves', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const raised = await storeRequest(company.id);

    await changeAssignees(ctx, support, {
      request: raised.id,
      add: [support.id, manager.id],
      remove: [],
    });
    // Being taken off it is no news.
    await changeAssignees(ctx, support, { request: raised.id, add: [], remove: [manager.id] });

    expect(await queuedFor({ support, manager })).toEqual(['manager:assigned']);
  });

  it('tells the people a new request’s description mentions, and nobody else', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin', 'anna@adiutor.test');
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support');

    await raiseRequest(ctx, admin, {
      companyId: company.id,
      title: 'The printer is broken',
      description: `${writtenMentionMarker('wim', mentionKey(company.id, watcher.id))} saw it first.`,
      type: 'bug',
    });

    // A new request emails nobody: not the staff, and not whoever raised it.
    expect(await queuedFor({ admin, watcher, support })).toEqual(['watcher:mentioned']);
  });

  it('tells someone an edit mentions newly, not someone the text mentioned already', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    const toCasey = writtenMentionMarker('casey', mentionKey(company.id, client.id));
    const toWim = writtenMentionMarker('wim', mentionKey(company.id, watcher.id));
    await replyToRequest(ctx, support, { request: raised.id, body: `Which one, ${toCasey}?` });
    const [reply] = await db.select({ id: requestEntry.id }).from(requestEntry);
    await db.delete(queuedJob);

    await editReply(ctx, support, {
      request: raised.id,
      entry: reply?.id ?? '',
      text: `Which one, ${toCasey} or ${toWim}?`,
      edits: 0,
    });

    // An edit is no news to the people on the request: only the mention it adds is.
    expect(await queuedFor({ client, watcher, support })).toEqual(['watcher:mentioned']);
  });

  it('tells nobody about an internal note, also when it or an edit of it mentions someone', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [client.id, manager.id]);
    const toCasey = writtenMentionMarker('casey', mentionKey(company.id, client.id));
    const toMorgan = writtenMentionMarker('morgan', mentionKey(company.id, manager.id));
    await addNote(ctx, support, { request: raised.id, body: `Ask ${toMorgan} first.` });
    const [note] = await db
      .select({ id: requestEntry.id })
      .from(requestEntry)
      .where(eq(requestEntry.kind, 'note'));

    await editReply(ctx, support, {
      request: raised.id,
      entry: note?.id ?? '',
      text: `Ask ${toMorgan} first, then ${toCasey}.`,
      edits: 0,
    });

    expect(await queuedFor({ client, manager, support })).toEqual([]);
  });

  it('tells someone another person subscribed, not someone who subscribed themselves', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const watcher = await memberActor(db, company.id, 'watcher');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await subscribe(ctx, watcher, { request: raised.id });

    await changeSubscribers(ctx, support, {
      request: raised.id,
      // The watcher follows it already, so nothing changes for them.
      add: [client.id, watcher.id, support.id].map((id) => mentionKey(company.id, id)),
      remove: [],
    });

    expect(await queuedFor({ client, watcher, support })).toEqual(['client:subscribed']);
  });
});

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

    const update = await readRequestUpdate(
      ctx,
      { requestId: raised.id, userId: watcher.id },
      await newsFor(watcher.id),
    );

    expect(update).toMatchObject({
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
    expect(status).toEqual({ event: 'status', by: 'sam', from: 'open', to: 'waiting' });
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
    });
    // Never the ID of whoever did it.
    expect(JSON.stringify(update?.items)).not.toContain(admin.id);
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
});
