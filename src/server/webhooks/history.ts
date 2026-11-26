/**
 * @file A webhook's deliveries, for the staff Admins who manage webhooks:
 * the list of the last 30 days, newest first ({@link listDeliveries}); a
 * test, sent while the Admin waits ({@link sendTestEvent}); and sending a
 * delivery again ({@link resendDelivery}).
 *
 * A test is sent from the request itself, at most 10 seconds, rather than
 * queued (an exception to decision 0018, recorded in decision 0046): queued,
 * it could wait minutes for a tick, and the Admin wants to know now. It's
 * recorded with its result once it's sent, and never counts towards turning
 * the webhook off. Both a test and sending again connect to an address, so
 * they're rate-limited.
 */
import { and, eq, sql } from 'drizzle-orm';

import { request, webhook, webhookDelivery } from '@/db/schema';
import { formatRequestNumber } from '@/lib/requests';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { WEBHOOK_DELIVERIES_TABLE, type WebhookDeliverySort } from '@/lib/tables/tables';
import type { WebhookDeliveryStatus, WebhookErrorKind, WebhookEvent } from '@/lib/webhooks';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { notFoundError, parseId, ServiceError } from '../errors';
import { orderTerms, paginate } from '../pagination';
import getRequestPrefix from '../people/request-prefix';
import { queueJob, webhookDeliveryJob } from '../queue';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { defaultLanguage } from '../recipient-locale';
import { openSecret } from '../sealed-secrets';
import assertManagesWebhooks from './access';
import { testChatBody, testJsonBody } from './formats';
import { sendWebhook } from './send';

/** A delivery as a webhook's page shows it: what it told of and how it went, never what was sent. */
export interface DeliveryView {
  /** Its ID, which the receiver got as `webhook-id`. */
  id: string;
  /** Whether it was a test. */
  test: boolean;
  /** What it told of, in order (none for a test). */
  events: WebhookEvent[];
  /** The request it told of: its number as people see it, and its number for the link. */
  request: { number: number; reference: string } | null;
  /** Where it stands. */
  status: WebhookDeliveryStatus;
  /** How many attempts it had. */
  attempts: number;
  /** When the last attempt was made. */
  lastAttemptAt: Date | null;
  /** The status the receiver last answered with. */
  lastStatus: number | null;
  /** How the last attempt failed. */
  lastError: WebhookErrorKind | null;
  /** How long the last attempt took, in milliseconds. */
  lastDurationMs: number | null;
  /** When the next attempt is due, while it's pending. */
  nextAttemptAt: Date | null;
  /** When it was made. */
  createdAt: Date;
}

/** How a test went, as the page tells the Admin. */
export interface TestResult {
  /** Whether the receiver took it. */
  delivered: boolean;
  /** The status it answered with, if it answered. */
  status: number | null;
  /** How it failed, when it did. */
  error: WebhookErrorKind | null;
}

/**
 * Finds a webhook the actor manages.
 *
 * @param ctx - Service context.
 * @param ref - The webhook's ID, as given.
 * @returns The webhook.
 * @throws {ServiceError} `not_found` when there's no such webhook.
 */
async function findWebhook(ctx: ServiceContext, ref: string) {
  const [found] = await ctx.db
    .select({
      id: webhook.id,
      name: webhook.name,
      format: webhook.format,
      urlSealed: webhook.urlSealed,
      secretSealed: webhook.secretSealed,
    })
    .from(webhook)
    .where(eq(webhook.id, parseId(ref)));
  if (!found) {
    throw notFoundError();
  }
  return found;
}

/**
 * Lists a webhook's deliveries, newest first unless the table says
 * otherwise: what each told of and how it went.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param ref - Which webhook.
 * @param ref.webhook - Its ID.
 * @param options - The table's state (sort, page, size).
 * @returns One page of deliveries.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `not_found`.
 */
export async function listDeliveries(
  ctx: ServiceContext,
  actor: Actor,
  ref: { webhook: string },
  options: Partial<TableState<WebhookDeliverySort>> = {},
): Promise<Paged<DeliveryView>> {
  assertManagesWebhooks(actor);
  const found = await findWebhook(ctx, ref.webhook);
  const state = resolveTableState(WEBHOOK_DELIVERIES_TABLE, options);
  const where = eq(webhookDelivery.webhookId, found.id);
  const [page, prefix] = await Promise.all([
    paginate(
      state,
      () => ctx.db.$count(webhookDelivery, where),
      (limit, offset) =>
        ctx.db
          .select({
            id: webhookDelivery.id,
            test: webhookDelivery.test,
            news: webhookDelivery.news,
            number: request.number,
            status: webhookDelivery.status,
            attempts: webhookDelivery.attempts,
            lastAttemptAt: webhookDelivery.lastAttemptAt,
            lastStatus: webhookDelivery.lastStatus,
            lastError: webhookDelivery.lastError,
            lastDurationMs: webhookDelivery.lastDurationMs,
            nextAttemptAt: webhookDelivery.nextAttemptAt,
            createdAt: webhookDelivery.createdAt,
          })
          .from(webhookDelivery)
          .leftJoin(request, eq(webhookDelivery.requestId, request.id))
          .where(where)
          // IDs are time-ordered: by ID is by when it was made.
          .orderBy(...orderTerms(state.dir, webhookDelivery.id))
          .limit(limit)
          .offset(offset),
    ),
    getRequestPrefix(ctx.db),
  ]);
  return {
    ...page,
    items: page.items.map(({ news, number, ...row }) => ({
      ...row,
      events: news.map(({ event }) => event),
      request: number === null ? null : { number, reference: formatRequestNumber(prefix, number) },
    })),
  };
}

/**
 * Sends a test to a webhook while the Admin waits, also to one that's off
 * (to check it before turning it on), and records it with its result. The
 * test tells of no request: `webhook.test` with the webhook's name, or a chat
 * message saying it works.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param ref - Which webhook.
 * @param ref.webhook - Its ID.
 * @returns How it went.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `not_found`, `rate_limited`,
 *   or `invalid` when its address or secret can't be read.
 */
export async function sendTestEvent(
  ctx: ServiceContext,
  actor: Actor,
  ref: { webhook: string },
): Promise<TestResult> {
  assertManagesWebhooks(actor);
  const found = await findWebhook(ctx, ref.webhook);
  await assertRateLimit(ctx, `webhook-send:user:${actor.id}`, RATE_LIMITS.webhookSendsPerUser);
  const opened = await Promise.all([
    openSecret(found.urlSealed),
    openSecret(found.secretSealed),
  ]).catch(() => null);
  if (opened === null) {
    throw new ServiceError('invalid', 'errors.webhooks.unreadable');
  }
  const [url, secret] = opened;
  // The ID it's sent with is the one it's recorded with, made by the database as every ID is.
  const { rows } = await ctx.db.execute<{ id: string }>(sql`select uuidv7() as id`);
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('The database made no ID.');
  }
  const now = new Date();
  const body =
    found.format === 'chat'
      ? testChatBody({ name: found.name, locale: await defaultLanguage(ctx) })
      : testJsonBody({ name: found.name, now });
  const result = await sendWebhook({ url, secret, id, body }, { now });
  await ctx.db.insert(webhookDelivery).values({
    id,
    webhookId: found.id,
    test: true,
    status: result.delivered ? 'delivered' : 'failed',
    attempts: 1,
    lastAttemptAt: now,
    lastStatus: result.status,
    lastError: result.delivered ? null : result.error,
    lastDurationMs: result.durationMs,
    ...(result.delivered && { deliveredAt: now }),
  });
  return {
    delivered: result.delivered,
    status: result.status,
    error: result.delivered ? null : result.error,
  };
}

/**
 * Sends a delivery again, at the next tick: one more attempt, whatever it
 * had before (no further attempts follow by themselves once its own ran
 * out), with only the news the webhook still wants (`attemptDelivery`).
 * Only for a delivery that's over (delivered, failed or cancelled), of a
 * webhook that's on; never a test, which the Admin sends anew.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param ref - Which delivery.
 * @param ref.webhook - Its webhook's ID.
 * @param ref.delivery - Its ID.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `not_found`, `rate_limited`,
 *   or `conflict` when the webhook is off or the delivery is still under way.
 */
export async function resendDelivery(
  ctx: ServiceContext,
  actor: Actor,
  ref: { webhook: string; delivery: string },
): Promise<void> {
  assertManagesWebhooks(actor);
  const webhookId = parseId(ref.webhook);
  const deliveryId = parseId(ref.delivery);
  await assertRateLimit(ctx, `webhook-send:user:${actor.id}`, RATE_LIMITS.webhookSendsPerUser);
  await ctx.db.transaction(async (tx) => {
    // The webhook's row first, then its delivery's: the order every change to them takes.
    const [found] = await tx
      .select({ turnedOffAt: webhook.turnedOffAt })
      .from(webhook)
      .where(eq(webhook.id, webhookId))
      .for('no key update');
    const [delivery] = found
      ? await tx
          .select({
            status: webhookDelivery.status,
            attempts: webhookDelivery.attempts,
            test: webhookDelivery.test,
          })
          .from(webhookDelivery)
          .where(and(eq(webhookDelivery.id, deliveryId), eq(webhookDelivery.webhookId, webhookId)))
          .for('update')
      : [];
    if (!found || !delivery || delivery.test) {
      throw notFoundError();
    }
    if (found.turnedOffAt !== null) {
      throw new ServiceError('conflict', 'errors.webhooks.off');
    }
    if (delivery.status === 'pending') {
      throw new ServiceError('conflict', 'errors.webhooks.stillSending');
    }
    const now = new Date();
    await tx
      .update(webhookDelivery)
      .set({ status: 'pending', nextAttemptAt: now })
      .where(eq(webhookDelivery.id, deliveryId));
    await queueJob(tx, webhookDeliveryJob, { deliveryId, attempt: delivery.attempts + 1 });
  });
}
