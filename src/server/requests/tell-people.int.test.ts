/**
 * @file Integration tests for who is told about a request: who a reply, a
 * status change and an internal note are queued for, and who is told they
 * were put on a request. What their email shows is tested in
 * `read-request-update.int.test.ts`, sending itself with the job
 * (`src/server/jobs/queued/request-updates.int.test.ts`).
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { membership, queuedJob, requestEntry, user } from '@/db/schema';
import { writtenMentionMarker } from '@/lib/requests';

import { createCompany, memberActor, staffActor } from '../../../tests/integration/helpers';
import { changeAssignees } from './assignees';
import { editReply } from './edits';
import mentionKey from './mention-key';
import addNote from './notes';
import raiseRequest from './raise';
import replyToRequest from './reply';
import changeRequestStatus from './status';
import { changeSubscribers, subscribe } from './subscribers';
import { ctx, db, storeRequest, storeSubscribers, storeAssignees } from './test-helpers';

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

  it('tells someone a request was raised for, once, also when its description mentions them', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support');
    const toCasey = writtenMentionMarker('casey', mentionKey(company.id, client.id));
    const toWim = writtenMentionMarker('wim', mentionKey(company.id, watcher.id));

    await raiseRequest(ctx, support, {
      companyId: company.id,
      title: 'The printer is broken',
      description: `${toCasey} called about it; ${toWim} saw it first.`,
      type: 'bug',
      raisedFor: mentionKey(company.id, client.id),
    });

    // Not the staff member who raised it, who follows it too.
    expect(await queuedFor({ client, watcher, support })).toEqual([
      'client:raised',
      'watcher:mentioned',
    ]);
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

  it('tells the staff on the request about an internal note, never anyone at the company', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const finance = await staffActor(db, 'finance');
    const admin = await staffActor(db, 'platform_admin');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [client.id, manager.id, finance.id]);
    await storeAssignees(raised.id, [admin.id]);
    const toCasey = writtenMentionMarker('casey', mentionKey(company.id, client.id));
    const toMorgan = writtenMentionMarker('morgan', mentionKey(company.id, manager.id));

    await addNote(ctx, support, { request: raised.id, body: `Ask ${toMorgan}, not ${toCasey}.` });

    // The assignee and the staff subscribers hear of it; the staff it mentions as a mention. The
    // client it mentions, and the writer, hear nothing.
    expect(await queuedFor({ client, manager, finance, admin, support })).toEqual([
      'admin:note',
      'finance:note',
      'manager:mentioned',
    ]);
  });

  it('tells the staff an edit of a note mentions newly, and still nobody at the company', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const raised = await storeRequest(company.id);
    await addNote(ctx, support, { request: raised.id, body: 'Ask around first.' });
    const [note] = await db
      .select({ id: requestEntry.id })
      .from(requestEntry)
      .where(eq(requestEntry.kind, 'note'));
    const toCasey = writtenMentionMarker('casey', mentionKey(company.id, client.id));
    const toMorgan = writtenMentionMarker('morgan', mentionKey(company.id, manager.id));

    await editReply(ctx, support, {
      request: raised.id,
      entry: note?.id ?? '',
      text: `Ask ${toMorgan} first, then ${toCasey}.`,
      edits: 0,
    });

    expect(await queuedFor({ client, manager, support })).toEqual(['manager:mentioned']);
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
