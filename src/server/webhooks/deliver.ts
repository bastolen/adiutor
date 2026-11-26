/**
 * @file Delivering news to webhooks (decision 0046). The `request-update`
 * batch hands over a webhook's jobs about one request ({@link deliverWebhookNews}):
 * the news its webhook still wants is stored as one delivery, with the IDs of
 * what it tells of, and its first attempt is made straight away
 * ({@link attemptDelivery}).
 *
 * An attempt reads the news when it's sent (`readWebhookNews`), opens the
 * webhook's address and secret, sends outside any transaction and then
 * records its result, under the webhook's row. It goes on only while the
 * delivery is still pending with exactly the attempts before it recorded,
 * and records only if that still holds, so an attempt that runs twice (a job
 * taken again) sends at most once more and never records twice. A receiver
 * that's down is no fault of Adiutor's: the attempt records it and ends;
 * only Adiutor's own faults (the database) throw.
 */
import { and, eq } from 'drizzle-orm';

import { webhook, webhookDelivery, webhookRequestType } from '@/db/schema';
import { webhookCovers, type WebhookEvent } from '@/lib/webhooks';

import type { ServiceContext } from '../context';
import { defaultLanguage } from '../recipient-locale';
import { readWebhookNews, type WebhookNews } from '../requests';
import { openSecret } from '../sealed-secrets';
import { chatBody, jsonBody } from './formats';
import { sendWebhook, type WebhookSendResult } from './send';

/** A webhook's piece of news, as the `request-update` batch hands it over. */
export interface QueuedWebhookJob {
  /** The queued job's ID. */
  jobId: string;
  /** The request. */
  requestId: string;
  /** The webhook. */
  webhookId: string;
  /** The request type that made the webhook hear of it. */
  typeKey: string;
  /** What happened. */
  event: WebhookEvent;
  /** The entry it's about; `null` for the request being raised. */
  entryId: string | null;
}

/**
 * Cancels a delivery that's still at the attempt this one expected.
 *
 * @param ctx - Service context.
 * @param deliveryId - The delivery.
 * @param attempt - The attempt that found it can't be sent.
 */
async function cancel(ctx: ServiceContext, deliveryId: string, attempt: number): Promise<void> {
  await ctx.db
    .update(webhookDelivery)
    .set({ status: 'cancelled', nextAttemptAt: null })
    .where(
      and(
        eq(webhookDelivery.id, deliveryId),
        eq(webhookDelivery.status, 'pending'),
        eq(webhookDelivery.attempts, attempt - 1),
      ),
    );
}

/**
 * Records an attempt's result, if the delivery is still at the attempt
 * before it: a receiver that took it (`2xx`) makes it delivered and ends the
 * webhook's run of failures; anything else makes it failed.
 *
 * @param ctx - Service context.
 * @param target - The delivery, its webhook and the attempt.
 * @param target.deliveryId - The delivery.
 * @param target.webhookId - Its webhook.
 * @param target.attempt - The attempt, from 1.
 * @param result - How it went.
 */
async function record(
  ctx: ServiceContext,
  target: { deliveryId: string; webhookId: string; attempt: number },
  result: WebhookSendResult,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    // The webhook's row first, then its delivery's: the order its changes take too.
    await tx
      .select({ id: webhook.id })
      .from(webhook)
      .where(eq(webhook.id, target.webhookId))
      .for('no key update');
    const now = new Date();
    const recorded = await tx
      .update(webhookDelivery)
      .set({
        attempts: target.attempt,
        lastAttemptAt: now,
        lastStatus: result.status,
        lastError: result.delivered ? null : result.error,
        lastDurationMs: result.durationMs,
        nextAttemptAt: null,
        status: result.delivered ? 'delivered' : 'failed',
        ...(result.delivered && { deliveredAt: now }),
      })
      .where(
        and(
          eq(webhookDelivery.id, target.deliveryId),
          eq(webhookDelivery.status, 'pending'),
          eq(webhookDelivery.attempts, target.attempt - 1),
        ),
      )
      .returning({ id: webhookDelivery.id });
    if (recorded.length > 0 && result.delivered) {
      await tx.update(webhook).set({ failingSince: null }).where(eq(webhook.id, target.webhookId));
    }
  });
}

/**
 * Makes one attempt to deliver: reads the news, sends it, records how it
 * went. Does nothing unless the delivery is pending with exactly the
 * attempts before this one recorded; cancels it when its webhook is off or
 * its news is gone.
 *
 * @param ctx - Service context.
 * @param deliveryId - The delivery.
 * @param attempt - Which attempt this is, from 1.
 * @param preloaded - The news, when the caller has just read it.
 * @returns `done` when it was sent (whatever the receiver said), `skipped` otherwise.
 */
export async function attemptDelivery(
  ctx: ServiceContext,
  deliveryId: string,
  attempt: number,
  preloaded?: WebhookNews,
): Promise<'done' | 'skipped'> {
  const [found] = await ctx.db
    .select({
      requestId: webhookDelivery.requestId,
      news: webhookDelivery.news,
      status: webhookDelivery.status,
      attempts: webhookDelivery.attempts,
      webhookId: webhook.id,
      urlSealed: webhook.urlSealed,
      secretSealed: webhook.secretSealed,
      format: webhook.format,
      turnedOffAt: webhook.turnedOffAt,
    })
    .from(webhookDelivery)
    .innerJoin(webhook, eq(webhookDelivery.webhookId, webhook.id))
    .where(eq(webhookDelivery.id, deliveryId));
  if (!found || found.status !== 'pending' || found.attempts !== attempt - 1) {
    return 'skipped';
  }
  if (found.turnedOffAt !== null || found.requestId === null) {
    await cancel(ctx, deliveryId, attempt);
    return 'skipped';
  }
  const news = preloaded ?? (await readWebhookNews(ctx.db, found.requestId, found.news));
  if (news === null) {
    await cancel(ctx, deliveryId, attempt);
    return 'skipped';
  }
  const target = { deliveryId, webhookId: found.webhookId, attempt };
  const opened = await Promise.all([
    openSecret(found.urlSealed),
    openSecret(found.secretSealed),
  ]).catch(() => null);
  if (opened === null) {
    await record(ctx, target, {
      delivered: false,
      status: null,
      error: 'unreadable',
      durationMs: 0,
    });
    return 'done';
  }
  const [url, secret] = opened;
  const now = new Date();
  const body =
    found.format === 'chat'
      ? chatBody(news, { baseUrl: ctx.baseUrl, locale: await defaultLanguage(ctx) })
      : jsonBody(news, { baseUrl: ctx.baseUrl, now });
  const result = await sendWebhook({ url, secret, id: deliveryId, body }, { now });
  await record(ctx, target, result);
  return 'done';
}

/**
 * Stores the news one tick has for a webhook about a request as one
 * delivery, and makes its first attempt. News the webhook no longer wants
 * (it's off or gone, it no longer chooses the event or covers the type the
 * news was queued for) and news that's no longer there are skipped.
 *
 * @param ctx - Service context.
 * @param jobs - The webhook's jobs about one request, in the order they were queued.
 * @returns The jobs that were skipped.
 */
export async function deliverWebhookNews(
  ctx: ServiceContext,
  jobs: readonly QueuedWebhookJob[],
): Promise<{ skipped: string[] }> {
  const [first] = jobs;
  if (!first) {
    return { skipped: [] };
  }
  // One batch key is one webhook and one request: news about another would be a mistake.
  const ours = jobs.filter(
    ({ webhookId, requestId }) => webhookId === first.webhookId && requestId === first.requestId,
  );
  const [found] = await ctx.db
    .select({
      events: webhook.events,
      allTypes: webhook.allTypes,
      turnedOffAt: webhook.turnedOffAt,
    })
    .from(webhook)
    .where(eq(webhook.id, first.webhookId));
  if (!found || found.turnedOffAt !== null) {
    return { skipped: jobs.map(({ jobId }) => jobId) };
  }
  const types = found.allTypes
    ? []
    : (
        await ctx.db
          .select({ key: webhookRequestType.requestTypeKey })
          .from(webhookRequestType)
          .where(eq(webhookRequestType.webhookId, first.webhookId))
      ).map(({ key }) => key);
  const choices = { events: found.events, allTypes: found.allTypes, types };
  const wanted = ours.filter(({ event, typeKey }) => webhookCovers(choices, { event, typeKey }));
  const news = wanted.flatMap(({ event, entryId }, index) =>
    // The same news queued twice is told once.
    wanted.findIndex((other) => other.event === event && other.entryId === entryId) === index
      ? [{ event, entryId }]
      : [],
  );
  const read = news.length === 0 ? null : await readWebhookNews(ctx.db, first.requestId, news);
  if (read === null) {
    return { skipped: jobs.map(({ jobId }) => jobId) };
  }
  const wantedIds = new Set(wanted.map(({ jobId }) => jobId));
  const [delivery] = await ctx.db
    .insert(webhookDelivery)
    .values({ webhookId: first.webhookId, requestId: first.requestId, news })
    .returning({ id: webhookDelivery.id });
  if (delivery) {
    await attemptDelivery(ctx, delivery.id, 1, read);
  }
  return { skipped: jobs.filter(({ jobId }) => !wantedIds.has(jobId)).map(({ jobId }) => jobId) };
}
