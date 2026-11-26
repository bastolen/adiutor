/**
 * @file Integration tests for delivering news to webhooks through the
 * `request-update` job, against a receiver on 127.0.0.1 (which the tests'
 * environment allows): one signed delivery per webhook and request in a tick,
 * with the events in order; the chat format; news a webhook no longer wants,
 * or that's gone, skipped; how each kind of answer is recorded, never as a
 * failed job; the later attempts when they're due, up to the sixth; turning
 * a webhook off after three days of failures, a `410 Gone` or an address
 * that can't be read, with the staff Admins' email; and an attempt that
 * runs twice sending at most once.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { queuedJob, user, webhook, webhookDelivery } from '@/db/schema';

import { startWebhookReceiver, type WebhookReceiver } from '../../../tests/http/webhook-receiver';
import {
  auditEvents,
  createCompany,
  createStaffSettings,
  memberActor,
  readWebhook,
  sendQueuedEmails,
  setupTestContext,
  staffActor,
  storeParticipants,
  storeRequest,
  storeWebhook,
  TEST_WEBHOOK_SECRET,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { queueJobs, webhookDeliveryJob, webhookTurnedOffJob } from '../queue';
import { replyToRequest } from '../requests';
import { attemptDelivery } from './deliver';
import { signWebhook } from './signing';

const { ctx, db, sent } = setupTestContext();

let receiver: WebhookReceiver;
let company: Awaited<ReturnType<typeof createCompany>>;
let client: Actor;

beforeEach(async () => {
  receiver = await startWebhookReceiver();
  await createStaffSettings(db, 'Adiutor Tests Support');
  company = await createCompany(db, { name: 'Adiutor Tests Client' });
  client = await memberActor(db, company.id, 'client', 'pat.client@adiutor.test');
});

afterEach(async () => {
  await receiver.close();
});

/**
 * Runs the news in the queue, as the next tick would.
 *
 * @returns How the `request-update` runs ended.
 */
async function runNews() {
  const runs = await sendQueuedEmails(ctx);
  return runs.filter(({ job }) => job === 'request-update').map(({ status }) => status);
}

/**
 * Every delivery, oldest first.
 *
 * @returns Their rows.
 */
async function deliveries() {
  return db.select().from(webhookDelivery).orderBy(webhookDelivery.id);
}

/**
 * The later attempts waiting in the queue, beyond the first attempt every
 * delivery has queued as a safety net.
 *
 * @returns Each one's payload.
 */
async function laterAttempts() {
  const jobs = await db
    .select({ payload: queuedJob.payload })
    .from(queuedJob)
    .where(and(eq(queuedJob.kind, 'webhook-delivery'), eq(queuedJob.status, 'queued')));
  return jobs
    .map(({ payload }) => payload as { deliveryId: string; attempt: number })
    .filter(({ attempt }) => attempt > 1);
}

/** Makes every waiting job due now and runs the queue, as the tick when they're due would. */
async function runDueAttempts(): Promise<void> {
  await db.update(queuedJob).set({ runAt: new Date() }).where(eq(queuedJob.status, 'queued'));
  await sendQueuedEmails(ctx);
}

/**
 * Since when a webhook has been failing.
 *
 * @param webhookId - The webhook.
 * @returns The moment, or `null`.
 */
async function failingSince(webhookId: string) {
  const [row] = await db
    .select({ failingSince: webhook.failingSince })
    .from(webhook)
    .where(eq(webhook.id, webhookId));
  return row?.failingSince ?? null;
}

/**
 * A request waiting for the company, which the client's reply puts back in progress.
 *
 * @returns Its ID.
 */
async function replyThatMovesTheStatus(): Promise<string> {
  const { id } = await storeRequest(db, company.id, { status: 'waiting' });
  await replyToRequest(ctx, client, { request: id, body: 'It’s the one on **floor 2**.' });
  return id;
}

describe('delivering news to a webhook', () => {
  it('sends one signed delivery per tick with the events in order, and records it', async () => {
    const webhookId = await storeWebhook(db, { url: receiver.url });
    const requestId = await replyThatMovesTheStatus();

    expect(await runNews()).toEqual(['succeeded']);

    expect(receiver.received).toHaveLength(1);
    const [request] = receiver.received;
    const body = JSON.parse(request?.body ?? '{}') as {
      type: string;
      data: { request: { id: string }; events: { type: string }[] };
    };
    expect(body.type).toBe('request.updated');
    expect(body.data.request.id).toBe(requestId);
    expect(body.data.events.map(({ type }) => type)).toEqual(['reply', 'status']);
    expect(request?.body).not.toContain('@adiutor.test');
    expect(request?.body).not.toContain(client.id);
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({
      webhookId,
      requestId,
      status: 'delivered',
      attempts: 1,
      lastStatus: 200,
      lastError: null,
      deliveredAt: expect.any(Date),
    });
    expect(delivery?.news.map(({ event }) => event)).toEqual(['reply', 'status']);
    const id = String(request?.headers['webhook-id']);
    const timestamp = Number(request?.headers['webhook-timestamp']);
    expect(id).toBe(delivery?.id);
    expect(request?.headers['webhook-signature']).toBe(
      signWebhook(TEST_WEBHOOK_SECRET, { id, timestamp, body: request?.body ?? '' }),
    );
  });

  it('sends a chat message in Adiutor’s default language, beside the people’s emails', async () => {
    const support = await staffActor(db, 'support', 'sam.support@adiutor.test');
    await storeWebhook(db, { url: receiver.url, format: 'chat' });
    const { id } = await storeRequest(db, company.id, { status: 'waiting' });
    await storeParticipants(db, id, [client.id], 'subscriber');
    await replyToRequest(ctx, support, { request: id, body: 'Is it the one on floor 2?' });

    expect(await runNews()).toEqual(['succeeded']);

    expect(sent.map(({ to }) => to)).toEqual(['pat.client@adiutor.test']);
    const { text } = JSON.parse(receiver.received[0]?.body ?? '{}') as { text: string };
    expect(text.split('\n')).toEqual([
      expect.stringMatching(/^AD-\d+: The printer is broken$/),
      `${support.name} replied: Is it the one on floor 2?`,
      expect.stringMatching(/^https:\/\/adiutor\.test\/requests\/\d+\?entry=/),
    ]);
  });

  it('skips news a webhook no longer wants by the time it’s sent', async () => {
    const turnedOff = await storeWebhook(db, { url: receiver.url, name: 'Turned off' });
    const unchosen = await storeWebhook(db, { url: receiver.url, name: 'Unchosen' });
    const uncovered = await storeWebhook(db, {
      url: receiver.url,
      name: 'Uncovered',
      types: ['bug'],
    });
    await replyThatMovesTheStatus();
    await db
      .update(webhook)
      .set({ turnedOffAt: new Date(), turnedOffReason: 'manual' })
      .where(eq(webhook.id, turnedOff));
    await db
      .update(webhook)
      .set({ events: ['raised'] })
      .where(eq(webhook.id, unchosen));
    await db.update(webhook).set({ allTypes: false }).where(eq(webhook.id, uncovered));
    await db.execute(
      // The type it covered is no longer among its types.
      `delete from webhook_request_type where webhook_id = '${uncovered}'`,
    );

    expect(await runNews()).toEqual(['succeeded']);

    expect(receiver.received).toHaveLength(0);
    expect(await deliveries()).toEqual([]);
  });

  it('records a receiver that fails and queues the next attempt, without failing the job', async () => {
    receiver.answerWith({ status: 500, body: 'Something broke on our side.' });
    const webhookId = await storeWebhook(db, { url: receiver.url });
    await replyThatMovesTheStatus();
    const before = Date.now();

    expect(await runNews()).toEqual(['succeeded']);

    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastStatus: 500,
      lastError: 'http',
    });
    const waited = (delivery?.nextAttemptAt?.getTime() ?? 0) - before;
    expect(waited).toBeGreaterThan(4 * 60_000);
    expect(waited).toBeLessThan(6 * 60_000);
    expect(await laterAttempts()).toEqual([{ deliveryId: delivery?.id, attempt: 2 }]);
    expect(await failingSince(webhookId)).toEqual(expect.any(Date));
  });

  it('makes the next attempt when it’s due, and ends the run of failures once it’s taken', async () => {
    receiver.answerWith({ status: 503 });
    const webhookId = await storeWebhook(db, { url: receiver.url });
    await replyThatMovesTheStatus();
    await runNews();
    receiver.answerWith({ status: 202 });

    await runDueAttempts();

    expect(receiver.received).toHaveLength(2);
    // Every attempt is the same delivery: the same ID, for the receiver to drop one it has.
    expect(new Set(receiver.received.map(({ headers }) => headers['webhook-id'])).size).toBe(1);
    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: 'delivered', attempts: 2, lastStatus: 202 }),
    ]);
    expect(await failingSince(webhookId)).toBeNull();
  });

  it('gives a delivery up after its sixth attempt fails', async () => {
    receiver.answerWith({ status: 500 });
    await storeWebhook(db, { url: receiver.url });
    await replyThatMovesTheStatus();
    await runNews();

    for (let attempt = 2; attempt <= 6; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- one attempt after the other, as the ticks make them
      await runDueAttempts();
    }

    expect(receiver.received).toHaveLength(6);
    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: 'failed', attempts: 6, nextAttemptAt: null }),
    ]);
    expect(await laterAttempts()).toEqual([]);
  });

  it('turns a webhook off once it has failed for three days, and tells the staff Admins', async () => {
    receiver.answerWith({ status: 500 });
    const admin = await staffActor(db, 'platform_admin', 'ann.admin@adiutor.test');
    const gone = await staffActor(db, 'platform_admin', 'gone.admin@adiutor.test');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, gone.id));
    await staffActor(db, 'manager', 'max.manager@adiutor.test');
    const webhookId = await storeWebhook(db, {
      url: receiver.url,
      failingSince: new Date(Date.now() - 3 * 24 * 60 * 60_000 - 60_000),
    });
    const { id: otherRequest } = await storeRequest(db, company.id);
    const [waiting] = await db
      .insert(webhookDelivery)
      .values({ webhookId, requestId: otherRequest, attempts: 2 })
      .returning({ id: webhookDelivery.id });
    await replyThatMovesTheStatus();

    await runNews();

    expect(await readWebhook(db, webhookId)).toMatchObject({
      turnedOffReason: 'failing',
      turnedOffBy: null,
      turnedOffAt: expect.any(Date),
    });
    const rows = await deliveries();
    expect(rows.find(({ id }) => id === waiting?.id)?.status).toBe('cancelled');
    expect(rows.find(({ id }) => id !== waiting?.id)?.status).toBe('failed');
    expect(
      await auditEvents(db, { action: 'webhook_turned_off', fields: ['actorUserId', 'details'] }),
    ).toEqual([
      {
        actorUserId: null,
        details: {
          staff: true,
          webhook: 'Adiutor Tests hook',
          host: new URL(receiver.url).host,
          reason: 'failing',
        },
      },
    ]);

    await sendQueuedEmails(ctx);
    expect(sent.map(({ to, subject }) => ({ to, subject }))).toEqual([
      { to: admin.email, subject: 'Adiutor turned off the webhook “Adiutor Tests hook”' },
    ]);
  });

  it('turns a webhook off at once when its receiver is gone (410)', async () => {
    receiver.answerWith({ status: 410 });
    const webhookId = await storeWebhook(db, { url: receiver.url });
    await replyThatMovesTheStatus();

    await runNews();

    expect(await readWebhook(db, webhookId)).toMatchObject({ turnedOffReason: 'gone' });
    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: 'failed', attempts: 1, lastStatus: 410 }),
    ]);
    expect(await laterAttempts()).toEqual([]);
  });

  it('turns a webhook off when its address or secret can’t be read, without sending', async () => {
    const webhookId = await storeWebhook(db, { url: receiver.url });
    await db
      .update(webhook)
      .set({ urlSealed: 'sealed-with-a-dropped-secret' })
      .where(eq(webhook.id, webhookId));
    await replyThatMovesTheStatus();

    expect(await runNews()).toEqual(['succeeded']);

    expect(receiver.received).toHaveLength(0);
    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: 'failed', attempts: 1, lastError: 'unreadable' }),
    ]);
    const [row] = await db.select().from(webhook).where(eq(webhook.id, webhookId));
    expect(row?.turnedOffReason).toBe('unreadable');
  });

  it('sends no email about a webhook that was turned on again, or to someone no longer a staff Admin', async () => {
    const admin = await staffActor(db, 'platform_admin', 'ann.admin@adiutor.test');
    const manager = await staffActor(db, 'manager', 'max.manager@adiutor.test');
    const onAgain = await storeWebhook(db, { url: receiver.url });
    const stillOff = await storeWebhook(db, { off: { at: new Date(), reason: 'gone' } });
    await queueJobs(db, webhookTurnedOffJob, [
      { recipientId: admin.id, webhookId: onAgain, reason: 'gone' },
      { recipientId: manager.id, webhookId: stillOff, reason: 'gone' },
    ]);

    await sendQueuedEmails(ctx);

    expect(sent).toEqual([]);
  });

  it('cancels a later attempt of a webhook that was turned off meanwhile', async () => {
    receiver.answerWith({ status: 500 });
    const webhookId = await storeWebhook(db, { url: receiver.url });
    await replyThatMovesTheStatus();
    await runNews();
    await db
      .update(webhook)
      .set({ turnedOffAt: new Date(), turnedOffReason: 'manual' })
      .where(eq(webhook.id, webhookId));

    await runDueAttempts();

    expect(receiver.received).toHaveLength(1);
    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: 'cancelled', attempts: 1 }),
    ]);
  });

  it('queues the first attempt too, which does nothing once the first attempt recorded', async () => {
    await storeWebhook(db, { url: receiver.url });
    await replyThatMovesTheStatus();
    await runNews();
    const [delivery] = await deliveries();
    const [safetyNet] = await db
      .select({ payload: queuedJob.payload, runAt: queuedJob.runAt })
      .from(queuedJob)
      .where(and(eq(queuedJob.kind, 'webhook-delivery'), eq(queuedJob.status, 'queued')));
    expect(safetyNet?.payload).toEqual({ deliveryId: delivery?.id, attempt: 1 });

    await runDueAttempts();

    expect(receiver.received).toHaveLength(1);
    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: 'delivered', attempts: 1 }),
    ]);
  });

  it('makes a first attempt that never recorded later, under the same ID', async () => {
    const webhookId = await storeWebhook(db, { url: receiver.url });
    const { id: requestId } = await storeRequest(db, company.id);
    // As the batch leaves it when the database failed after it stored the delivery.
    const [orphan] = await db
      .insert(webhookDelivery)
      .values({ webhookId, requestId, news: [{ event: 'raised', entryId: null }] })
      .returning({ id: webhookDelivery.id });
    await queueJobs(db, webhookDeliveryJob, [{ deliveryId: orphan?.id ?? '', attempt: 1 }]);

    await runDueAttempts();

    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0]?.headers['webhook-id']).toBe(orphan?.id);
    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: 'delivered', attempts: 1 }),
    ]);
  });

  it('never sends an attempt again once it’s recorded', async () => {
    await storeWebhook(db, { url: receiver.url });
    await replyThatMovesTheStatus();
    await runNews();
    const [delivery] = await deliveries();

    expect(await attemptDelivery(ctx, delivery?.id ?? '', 1)).toBe('skipped');
    expect(receiver.received).toHaveLength(1);
    expect(sent).toEqual([]);
  });
});
