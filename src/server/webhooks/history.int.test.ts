/**
 * @file Integration tests for a webhook's deliveries: the list, newest
 * first, with what each told of and how it went; a test sent while the
 * Admin waits, recorded with its result and never counting towards turning
 * the webhook off; and sending a delivery again, one more attempt at the
 * next tick. Which roles may do this is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { queuedJob, webhook, webhookDelivery } from '@/db/schema';

import { startWebhookReceiver, type WebhookReceiver } from '../../../tests/http/webhook-receiver';
import {
  createCompany,
  createStaffSettings,
  fillRateLimitBucket,
  readWebhook,
  sendQueuedEmails,
  setupTestContext,
  staffActor,
  storeRequest,
  storeWebhook,
  TEST_WEBHOOK_SECRET,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { RATE_LIMITS } from '../rate-limit';
import { listDeliveries, resendDelivery, sendTestEvent } from './history';
import { signWebhook } from './signing';

const { ctx, db } = setupTestContext();

let receiver: WebhookReceiver;
let admin: Actor;
let company: Awaited<ReturnType<typeof createCompany>>;

beforeEach(async () => {
  receiver = await startWebhookReceiver();
  await createStaffSettings(db);
  admin = await staffActor(db, 'platform_admin');
  company = await createCompany(db);
});

afterEach(async () => {
  await receiver.close();
});

/**
 * Every delivery, oldest first.
 *
 * @returns Their rows.
 */
async function deliveries() {
  return db.select().from(webhookDelivery).orderBy(webhookDelivery.id);
}

describe('listDeliveries', () => {
  it('lists a webhook’s deliveries newest first, with what each told of and how it went', async () => {
    const webhookId = await storeWebhook(db);
    const other = await storeWebhook(db, { name: 'Other' });
    const { id: requestId, number } = await storeRequest(db, company.id);
    await db.insert(webhookDelivery).values({
      webhookId,
      requestId,
      news: [
        { event: 'reply', entryId: '019abcde-0000-7000-8000-000000000001', typeKey: 'bug' },
        { event: 'status', entryId: '019abcde-0000-7000-8000-000000000002', typeKey: 'bug' },
      ],
      status: 'failed',
      attempts: 6,
      lastStatus: 500,
      lastError: 'http',
    });
    await db
      .insert(webhookDelivery)
      .values({ webhookId, test: true, status: 'delivered', attempts: 1, lastStatus: 200 });
    await db.insert(webhookDelivery).values({ webhookId: other, requestId });

    const page = await listDeliveries(ctx, admin, { webhook: webhookId });

    expect(page.total).toBe(2);
    expect(page.items).toEqual([
      expect.objectContaining({ test: true, events: [], request: null, status: 'delivered' }),
      expect.objectContaining({
        test: false,
        events: ['reply', 'status'],
        request: { number, reference: `AD-${number}` },
        status: 'failed',
        attempts: 6,
        lastStatus: 500,
        lastError: 'http',
      }),
    ]);
    expect(
      (await listDeliveries(ctx, admin, { webhook: webhookId }, { dir: 'asc' })).items[0]?.test,
    ).toBe(false);
  });

  it('refuses a webhook that isn’t there', async () => {
    await expect(
      listDeliveries(ctx, admin, { webhook: '019abcde-0000-7000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('sendTestEvent', () => {
  it('sends a signed test while the Admin waits, and records it', async () => {
    const webhookId = await storeWebhook(db, { url: receiver.url, name: 'Procurement' });

    expect(await sendTestEvent(ctx, admin, { webhook: webhookId })).toEqual({
      delivered: true,
      status: 200,
      error: null,
    });

    const [request] = receiver.received;
    expect(JSON.parse(request?.body ?? '{}')).toMatchObject({
      type: 'webhook.test',
      data: { webhook: { name: 'Procurement' } },
    });
    const id = String(request?.headers['webhook-id']);
    expect(request?.headers['webhook-signature']).toBe(
      signWebhook(TEST_WEBHOOK_SECRET, {
        id,
        timestamp: Number(request?.headers['webhook-timestamp']),
        body: request?.body ?? '',
      }),
    );
    expect(await deliveries()).toEqual([
      expect.objectContaining({
        id,
        test: true,
        requestId: null,
        status: 'delivered',
        attempts: 1,
      }),
    ]);
  });

  it('sends a chat message for a chat webhook, also one that’s off', async () => {
    const webhookId = await storeWebhook(db, {
      url: receiver.url,
      name: 'Staff chat',
      format: 'chat',
      off: { at: new Date(), reason: 'manual' },
    });

    await sendTestEvent(ctx, admin, { webhook: webhookId });

    expect(JSON.parse(receiver.received[0]?.body ?? '{}')).toEqual({
      text: 'This is a test message from Adiutor for the webhook “Staff chat”. It works.',
    });
  });

  it('says how a test failed, without counting it towards turning the webhook off', async () => {
    receiver.answerWith({ status: 410 });
    const webhookId = await storeWebhook(db, { url: receiver.url });

    expect(await sendTestEvent(ctx, admin, { webhook: webhookId })).toEqual({
      delivered: false,
      status: 410,
      error: 'http',
    });

    expect(await readWebhook(db, webhookId)).toMatchObject({
      turnedOffAt: null,
      failingSince: null,
    });
    expect(await deliveries()).toEqual([expect.objectContaining({ test: true, status: 'failed' })]);
  });

  it('refuses an address or secret that can’t be read, and counts against the Admin’s limit', async () => {
    const unreadable = await storeWebhook(db);
    await db
      .update(webhook)
      .set({ secretSealed: 'sealed-with-a-dropped-secret' })
      .where(eq(webhook.id, unreadable));
    await expect(sendTestEvent(ctx, admin, { webhook: unreadable })).rejects.toMatchObject({
      code: 'invalid',
      key: 'errors.webhooks.unreadable',
    });

    const webhookId = await storeWebhook(db, { url: receiver.url });
    const busy = await staffActor(db, 'platform_admin');
    await fillRateLimitBucket(
      db,
      `webhook-send:user:${busy.id}`,
      RATE_LIMITS.webhookSendsPerUser.limit,
    );
    await expect(sendTestEvent(ctx, busy, { webhook: webhookId })).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(receiver.received).toHaveLength(0);
  });
});

describe('resendDelivery', () => {
  /**
   * Stores a delivery of a request to a webhook that's over.
   *
   * @param webhookId - The webhook.
   * @param values - How it ended.
   * @returns Its ID.
   */
  async function storeDelivery(
    webhookId: string,
    values: Partial<typeof webhookDelivery.$inferInsert> = {},
  ): Promise<string> {
    const { id: requestId } = await storeRequest(db, company.id);
    const [stored] = await db
      .insert(webhookDelivery)
      .values({
        webhookId,
        requestId,
        news: [{ event: 'raised', entryId: null, typeKey: 'bug' }],
        status: 'failed',
        attempts: 6,
        ...values,
      })
      .returning({ id: webhookDelivery.id });
    return stored?.id ?? '';
  }

  it('sends a delivery again at the next tick, as one more attempt', async () => {
    const webhookId = await storeWebhook(db, { url: receiver.url });
    const deliveryId = await storeDelivery(webhookId);

    await resendDelivery(ctx, admin, { webhook: webhookId, delivery: deliveryId });

    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: 'pending', attempts: 6 }),
    ]);
    await sendQueuedEmails(ctx);
    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0]?.headers['webhook-id']).toBe(deliveryId);
    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: 'delivered', attempts: 7, lastStatus: 200 }),
    ]);
  });

  it('makes no further attempts by itself when the one more fails', async () => {
    receiver.answerWith({ status: 500 });
    const webhookId = await storeWebhook(db, { url: receiver.url });
    const deliveryId = await storeDelivery(webhookId);

    await resendDelivery(ctx, admin, { webhook: webhookId, delivery: deliveryId });
    await sendQueuedEmails(ctx);

    expect(await deliveries()).toEqual([
      expect.objectContaining({ status: 'failed', attempts: 7, nextAttemptAt: null }),
    ]);
    const waiting = await db.select().from(queuedJob).where(eq(queuedJob.status, 'queued'));
    expect(waiting).toEqual([]);
  });

  it('refuses a webhook that’s off, a delivery still under way, a test or another webhook’s', async () => {
    const webhookId = await storeWebhook(db, { url: receiver.url });
    const off = await storeWebhook(db, { off: { at: new Date(), reason: 'failing' } });

    await expect(
      resendDelivery(ctx, admin, { webhook: off, delivery: await storeDelivery(off) }),
    ).rejects.toMatchObject({ code: 'conflict', key: 'errors.webhooks.off' });
    await expect(
      resendDelivery(ctx, admin, {
        webhook: webhookId,
        delivery: await storeDelivery(webhookId, { status: 'pending', attempts: 2 }),
      }),
    ).rejects.toMatchObject({ code: 'conflict', key: 'errors.webhooks.stillSending' });
    const [test] = await db
      .insert(webhookDelivery)
      .values({ webhookId, test: true, status: 'failed', attempts: 1 })
      .returning({ id: webhookDelivery.id });
    await expect(
      resendDelivery(ctx, admin, { webhook: webhookId, delivery: test?.id ?? '' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      resendDelivery(ctx, admin, { webhook: webhookId, delivery: await storeDelivery(off) }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
