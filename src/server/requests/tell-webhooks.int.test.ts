/**
 * @file Integration tests for which webhooks hear of what happens to a
 * request (`tellWebhooks`): every change that's news for them queues a
 * `request-update` job per webhook that's on, chose the event and covers
 * the request's type, whoever made the change; a change of type reaches the
 * webhooks of the old and the new type; and the jobs of one webhook and
 * request share a batch key. What's sent is tested with the delivery
 * (`src/server/webhooks/deliver.int.test.ts`).
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { queuedJob } from '@/db/schema';

import {
  createCompany,
  createStaffSettings,
  memberActor,
  staffActor,
  storeWebhook,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { changeAssignees, unassignFrom } from './assignees';
import updateRequestDetails from './details';
import addNote from './notes';
import raiseRequest from './raise';
import replyToRequest from './reply';
import answerSolution from './solutions';
import changeRequestStatus from './status';
import { ctx, db, storeRequest } from './test-helpers';

let company: Awaited<ReturnType<typeof createCompany>>;
let client: Actor;
let support: Actor;
let webhooks: Record<string, string>;

beforeEach(async () => {
  await createStaffSettings(db);
  company = await createCompany(db);
  client = await memberActor(db, company.id, 'client');
  support = await staffActor(db, 'support');
  webhooks = {
    everything: await storeWebhook(db, { name: 'Everything' }),
    bugs: await storeWebhook(db, { name: 'Bugs', types: ['bug'] }),
    hotfixes: await storeWebhook(db, { name: 'Hotfixes', types: ['hotfix'] }),
    replies: await storeWebhook(db, { name: 'Replies', events: ['reply'] }),
    off: await storeWebhook(db, { name: 'Off', off: { at: new Date(), reason: 'manual' } }),
  };
});

/**
 * The news queued for webhooks, as `<webhook>:<event>`, sorted.
 *
 * @returns What is queued for which webhook.
 */
async function queuedForWebhooks(): Promise<string[]> {
  const nameOf = new Map(Object.entries(webhooks).map(([name, id]) => [id, name]));
  const jobs = await db
    .select({ payload: queuedJob.payload })
    .from(queuedJob)
    .where(eq(queuedJob.kind, 'request-update'));
  return jobs
    .flatMap(({ payload }) => {
      const news = payload as { webhookId?: string; event: string };
      return news.webhookId
        ? [`${nameOf.get(news.webhookId) ?? news.webhookId}:${news.event}`]
        : [];
    })
    .sort();
}

/** Empties the queue, so a test sees only what its own change queued. */
async function emptyQueue(): Promise<void> {
  await db.delete(queuedJob);
}

describe('tellWebhooks', () => {
  it('tells the webhooks of a new request’s type that it was raised', async () => {
    await raiseRequest(ctx, client, {
      companyId: company.id,
      title: 'The printer is broken',
      description: 'It prints blank pages.',
      type: 'bug',
    });

    expect(await queuedForWebhooks()).toEqual(['bugs:raised', 'everything:raised']);
  });

  it('tells of a reply and the status change it brings, together for each webhook', async () => {
    const { id } = await storeRequest(company.id, { status: 'waiting' });

    await replyToRequest(ctx, client, { request: id, body: 'It’s the one on floor 2.' });

    expect(await queuedForWebhooks()).toEqual([
      'bugs:reply',
      'bugs:status',
      'everything:reply',
      'everything:status',
      'replies:reply',
    ]);
    const keys = await db.select({ batchKey: queuedJob.batchKey }).from(queuedJob);
    expect(new Set(keys.map(({ batchKey }) => batchKey))).toEqual(
      new Set(
        ['everything', 'bugs', 'replies'].map(
          (name) => `request-updates:${id}:webhook:${webhooks[name] ?? ''}`,
        ),
      ),
    );
  });

  it('tells of an internal note, a status change and a solution’s answer', async () => {
    const { id } = await storeRequest(company.id, { status: 'proposed' });

    await addNote(ctx, support, { request: id, body: 'The toner was empty.' });
    await answerSolution(ctx, client, { request: id, answer: 'deny', body: 'Still blank.' });
    await changeRequestStatus(ctx, support, { request: id, status: 'todo' });

    expect(await queuedForWebhooks()).toEqual([
      'bugs:note',
      'bugs:reply',
      'bugs:status',
      'bugs:status',
      'everything:note',
      'everything:reply',
      'everything:status',
      'everything:status',
      'replies:reply',
    ]);
  });

  it('tells of every assignment and removal, also one the staff member made themselves', async () => {
    const { id } = await storeRequest(company.id);

    await changeAssignees(ctx, support, { request: id, add: [support.id], remove: [] });
    await changeAssignees(ctx, support, { request: id, add: [], remove: [support.id] });

    expect(await queuedForWebhooks()).toEqual([
      'bugs:assignee',
      'bugs:assignee',
      'everything:assignee',
      'everything:assignee',
    ]);
  });

  it('tells of details, and a new type to the webhooks of the old and the new type', async () => {
    const { id } = await storeRequest(company.id);
    await emptyQueue();

    await updateRequestDetails(ctx, support, {
      request: id,
      title: 'The printer on floor 2 is broken',
      type: 'hotfix',
      priority: 'high',
      was: { title: 'The printer is broken', type: 'bug', priority: 'normal' },
    });

    expect(await queuedForWebhooks()).toEqual([
      ...Array<string>(3).fill('bugs:details'),
      ...Array<string>(3).fill('everything:details'),
      ...Array<string>(3).fill('hotfixes:details'),
    ]);
  });

  it('tells of someone taken off every request they were assigned to, by type', async () => {
    const bug = await storeRequest(company.id, { type: 'bug' });
    const hotfix = await storeRequest(company.id, { type: 'hotfix' });
    await changeAssignees(ctx, support, { request: bug.id, add: [support.id], remove: [] });
    await changeAssignees(ctx, support, { request: hotfix.id, add: [support.id], remove: [] });
    await emptyQueue();

    await db.transaction((tx) => unassignFrom(tx, support.id));

    expect(await queuedForWebhooks()).toEqual([
      'bugs:assignee',
      'everything:assignee',
      'everything:assignee',
      'hotfixes:assignee',
    ]);
  });
});
