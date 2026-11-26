/**
 * @file Integration tests for delivering news to webhooks through the
 * `request-update` job, against a receiver on 127.0.0.1 (which the tests'
 * environment allows): one signed delivery per webhook and request in a tick,
 * with the events in order; the chat format; news a webhook no longer wants,
 * or that's gone, skipped; how each kind of answer is recorded, never as a
 * failed job; and an attempt that runs twice sending at most once.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { webhook, webhookDelivery } from '@/db/schema';

import { startWebhookReceiver, type WebhookReceiver } from '../../../tests/http/webhook-receiver';
import {
  createCompany,
  createStaffSettings,
  memberActor,
  sendQueuedEmails,
  setupTestContext,
  staffActor,
  storeParticipants,
  storeRequest,
  storeWebhook,
  TEST_WEBHOOK_SECRET,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
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

  it('records a receiver that fails, without failing the job', async () => {
    receiver.answerWith({ status: 500, body: 'Something broke on our side.' });
    await storeWebhook(db, { url: receiver.url });
    await replyThatMovesTheStatus();

    expect(await runNews()).toEqual(['succeeded']);

    expect(await deliveries()).toEqual([
      expect.objectContaining({
        status: 'failed',
        attempts: 1,
        lastStatus: 500,
        lastError: 'http',
      }),
    ]);
  });

  it('records an address or secret that can’t be read, without sending', async () => {
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
