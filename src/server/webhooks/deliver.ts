/**
 * @file Delivering news to webhooks (decision 0046). The `request-update`
 * batch hands over a webhook's jobs about one request ({@link deliverWebhookNews}):
 * the news its webhook still wants is stored as one delivery, with the IDs of
 * what it tells of and a queued first attempt as a safety net, and that
 * first attempt is made straight away ({@link attemptDelivery}).
 *
 * An attempt reads the news when it's sent (`readWebhookNews`), opens the
 * webhook's address and secret, sends outside any transaction and then
 * records its result, under the webhook's row. It goes on only while the
 * delivery is still pending with exactly the attempts before it recorded,
 * and records only if that still holds, so an attempt that runs twice (a job
 * taken again) sends at most once more and never records twice. A receiver
 * that's down is no fault of Adiutor's: the attempt records it, queues the
 * next one for when it's due (5 minutes to a day later, six attempts in all)
 * and ends; only Adiutor's own faults (the database) throw. Three days of
 * nothing but failures, a `410 Gone` or an address that can't be read any
 * more turn the webhook off, and the staff Admins are emailed.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import { user, webhook, webhookDelivery, webhookRequestType } from '@/db/schema';
import { getGlobalPermissions } from '@/lib/authz/permissions';
import { PLATFORM_ROLES } from '@/lib/authz/roles';
import {
  WEBHOOK_FAILING_DAYS,
  WEBHOOK_RETRY_MINUTES,
  type WebhookChoices,
  webhookCovers,
  type WebhookEvent,
} from '@/lib/webhooks';

import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { queueJob, queueJobs, webhookDeliveryJob, webhookTurnedOffJob } from '../queue';
import { defaultLanguage } from '../recipient-locale';
import { readWebhookNews, type WebhookNews } from '../requests';
import { openSecret } from '../sealed-secrets';
import { chatBody, jsonBody } from './formats';
import { sendWebhook, type WebhookSendResult } from './send';

/** A day, in milliseconds. */
const DAY_MS = 24 * 60 * 60_000;

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
 * What a webhook chooses now: its events, and every type or the types it covers.
 *
 * @param ctx - Service context.
 * @param webhookId - The webhook.
 * @param found - Its events, and whether it covers every type.
 * @param found.events - Its events.
 * @param found.allTypes - Whether it covers every type.
 * @returns What it chooses.
 */
async function choicesOf(
  ctx: ServiceContext,
  webhookId: string,
  found: { events: readonly WebhookEvent[]; allTypes: boolean },
): Promise<WebhookChoices> {
  const types = found.allTypes
    ? []
    : (
        await ctx.db
          .select({ key: webhookRequestType.requestTypeKey })
          .from(webhookRequestType)
          .where(eq(webhookRequestType.webhookId, webhookId))
      ).map(({ key }) => key);
  return { events: found.events, allTypes: found.allTypes, types };
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

/** The staff roles that manage webhooks (`staff:manage`), who are told when one is turned off. */
const MANAGING_ROLES = PLATFORM_ROLES.filter((platformRole) =>
  getGlobalPermissions({ platformRole }).has('staff:manage'),
);

/**
 * Turns a webhook off because it can't be delivered to, if it's still on:
 * what was still to be delivered to it is cancelled, the audit log records
 * it (by nobody: Adiutor did it), and every active staff Admin gets an email.
 *
 * @param ctx - Service context.
 * @param tx - The transaction that holds the webhook's row.
 * @param found - The webhook, as locked.
 * @param found.id - Its ID.
 * @param found.name - Its name.
 * @param found.urlHost - Its address's host.
 * @param reason - Why.
 */
async function turnOff(
  ctx: ServiceContext,
  tx: DatabaseTransaction,
  found: { id: string; name: string; urlHost: string },
  reason: 'failing' | 'gone' | 'unreadable',
): Promise<void> {
  await tx
    .update(webhook)
    .set({ turnedOffAt: new Date(), turnedOffReason: reason, turnedOffBy: null })
    .where(eq(webhook.id, found.id));
  await tx
    .update(webhookDelivery)
    .set({ status: 'cancelled', nextAttemptAt: null })
    .where(and(eq(webhookDelivery.webhookId, found.id), eq(webhookDelivery.status, 'pending')));
  await recordEvent(
    ctx,
    {
      action: 'webhook_turned_off',
      actorUserId: null,
      details: { staff: true, webhook: found.name, host: found.urlHost, reason },
    },
    tx,
  );
  const admins = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(user.platformRole, MANAGING_ROLES), isNull(user.deactivatedAt)));
  await queueJobs(
    tx,
    webhookTurnedOffJob,
    admins.map(({ id }) => ({ recipientId: id, webhookId: found.id, reason })),
  );
}

/**
 * Records an attempt's result, if the delivery is still at the attempt
 * before it, under the webhook's row:
 *
 * - **taken** (`2xx`): delivered, and the webhook's run of failures ends;
 * - **gone** (`410`) or **unreadable** (its address or secret can't be
 *   opened): failed, and the webhook is turned off;
 * - **otherwise:** the webhook's run of failures goes on (or starts). Once
 *   it's {@link WEBHOOK_FAILING_DAYS} days old, the delivery fails and the
 *   webhook is turned off; before that, the next attempt is queued for when
 *   it's due (`WEBHOOK_RETRY_MINUTES`), until the last one fails.
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
    const [found] = await tx
      .select({
        id: webhook.id,
        name: webhook.name,
        urlHost: webhook.urlHost,
        turnedOffAt: webhook.turnedOffAt,
        failingSince: webhook.failingSince,
      })
      .from(webhook)
      .where(eq(webhook.id, target.webhookId))
      .for('no key update');
    if (!found) {
      return;
    }
    const now = new Date();
    const failingSince = found.failingSince ?? now;
    let next: { status: 'delivered' | 'failed' | 'pending'; nextAttemptAt: Date | null } = {
      status: 'failed',
      nextAttemptAt: null,
    };
    let offReason: 'failing' | 'gone' | 'unreadable' | null = null;
    if (result.delivered) {
      next = { status: 'delivered', nextAttemptAt: null };
    } else if (result.status === 410) {
      offReason = 'gone';
    } else if (result.error === 'unreadable') {
      offReason = 'unreadable';
    } else if (now.getTime() - failingSince.getTime() >= WEBHOOK_FAILING_DAYS * DAY_MS) {
      offReason = 'failing';
    } else {
      const wait = WEBHOOK_RETRY_MINUTES[target.attempt - 1];
      if (wait !== undefined) {
        next = { status: 'pending', nextAttemptAt: new Date(now.getTime() + wait * 60_000) };
      }
    }
    const recorded = await tx
      .update(webhookDelivery)
      .set({
        attempts: target.attempt,
        lastAttemptAt: now,
        lastStatus: result.status,
        lastError: result.delivered ? null : result.error,
        lastDurationMs: result.durationMs,
        ...next,
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
    if (recorded.length === 0) {
      return;
    }
    await tx
      .update(webhook)
      .set({ failingSince: result.delivered ? null : failingSince })
      .where(eq(webhook.id, found.id));
    if (next.status === 'pending' && next.nextAttemptAt) {
      await queueJob(
        tx,
        webhookDeliveryJob,
        { deliveryId: target.deliveryId, attempt: target.attempt + 1 },
        { runAt: next.nextAttemptAt },
      );
    }
    if (offReason !== null && found.turnedOffAt === null) {
      await turnOff(ctx, tx, found, offReason);
    }
  });
}

/**
 * Makes one attempt to deliver: reads the news, sends it, records how it
 * went. Does nothing unless the delivery is pending with exactly the
 * attempts before this one recorded; sends only the news the webhook still
 * wants (its events and types now, as an Admin may have unticked one since),
 * and cancels it when its webhook is off or none of its news is left.
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
      events: webhook.events,
      allTypes: webhook.allTypes,
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
  // Only what the webhook still wants: an Admin may have unticked an event or a type since.
  const choices = await choicesOf(ctx, found.webhookId, found);
  const wanted = found.news.filter(({ event, typeKey }) =>
    webhookCovers(choices, { event, typeKey }),
  );
  const news =
    preloaded ??
    (wanted.length === 0 ? null : await readWebhookNews(ctx.db, found.requestId, wanted));
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
 * delivery, with its first attempt queued for later as a safety net in the
 * same transaction, and makes that first attempt straight away. News the
 * webhook no longer wants (it's off or gone, it no longer chooses the event
 * or covers the type the news was queued for) and news that's no longer
 * there are skipped. Once the delivery is stored, nothing here throws: a
 * first attempt that fails on Adiutor's side is made again by the queued
 * one, under the same `webhook-id`, rather than by running the batch again,
 * which would make a second delivery of the same news. While the webhook is
 * failing (`failing_since`), the first attempt is left to the queued one, so
 * a receiver that's down never holds up the emails about requests, which run
 * in the same batches.
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
      failingSince: webhook.failingSince,
    })
    .from(webhook)
    .where(eq(webhook.id, first.webhookId));
  if (!found || found.turnedOffAt !== null) {
    return { skipped: jobs.map(({ jobId }) => jobId) };
  }
  const choices = await choicesOf(ctx, first.webhookId, found);
  const wanted = ours.filter(({ event, typeKey }) => webhookCovers(choices, { event, typeKey }));
  const news = wanted.flatMap(({ event, entryId, typeKey }, index) =>
    // The same news queued twice is told once.
    wanted.findIndex((other) => other.event === event && other.entryId === entryId) === index
      ? [{ event, entryId, typeKey }]
      : [],
  );
  const read = news.length === 0 ? null : await readWebhookNews(ctx.db, first.requestId, news);
  if (read === null) {
    return { skipped: jobs.map(({ jobId }) => jobId) };
  }
  const wantedIds = new Set(wanted.map(({ jobId }) => jobId));
  // The delivery and a later first attempt are stored together: once they are, the batch is
  // done, and the delivery is sent even if the attempt below never records (the database failed,
  // the process died). That later attempt does nothing once this one recorded.
  const deliveryId = await ctx.db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(webhookDelivery)
      .values({ webhookId: first.webhookId, requestId: first.requestId, news })
      .returning({ id: webhookDelivery.id });
    if (stored) {
      await queueJob(
        tx,
        webhookDeliveryJob,
        { deliveryId: stored.id, attempt: 1 },
        { runAt: new Date(Date.now() + (WEBHOOK_RETRY_MINUTES[0] ?? 5) * 60_000) },
      );
    }
    return stored?.id;
  });
  // While the webhook is failing, its first attempt is left to the queued one: a receiver that's
  // down would otherwise hold up the emails about requests, which share this batch, by an attempt's
  // seconds for every piece of news.
  if (deliveryId && found.failingSince === null) {
    try {
      await attemptDelivery(ctx, deliveryId, 1, read);
    } catch {
      // A fault of Adiutor's own: the queued first attempt makes it again, under the same ID, so
      // running the batch again (a second delivery the receiver couldn't tell apart) isn't needed.
      // eslint-disable-next-line no-console -- The delivery's ID only: the queued attempt shows up in the history.
      console.warn(`Webhook delivery ${deliveryId}: its first attempt failed and is made later.`);
    }
  }
  return { skipped: jobs.filter(({ jobId }) => !wantedIds.has(jobId)).map(({ jobId }) => jobId) };
}
