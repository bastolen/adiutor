/**
 * @file The queued news about requests (`request-update`): one job per
 * recipient and piece of news, queued in the transaction of the change. A
 * recipient is a person on the request, who gets an email (decision 0031),
 * or a webhook (decision 0046). Jobs for the same request and recipient run
 * together, so a reply and the status change that came with it make one
 * email, or one delivery. A payload holds IDs and the kind of news only; the
 * names and the text are read when it's sent.
 */
import { z } from 'zod';

import { WEBHOOK_EVENTS } from '@/lib/webhooks';

import { defineQueuedKind } from './define';

/**
 * What an email about a request can tell someone: someone else replied
 * (`reply`), wrote an internal note (`note`, only ever for the staff) or
 * changed its status (`status`), or put them on the request: assigned it to
 * them (`assigned`), mentioned them in one of its texts (`mentioned`),
 * subscribed them to it (`subscribed`) or raised it for them (`raised`, for
 * a request a staff member raised for someone at the company).
 */
const REQUEST_UPDATE_EVENTS = [
  'reply',
  'note',
  'status',
  'assigned',
  'mentioned',
  'subscribed',
  'raised',
] as const;

/** One kind of news about a request. */
export type RequestUpdateEvent = (typeof REQUEST_UPDATE_EVENTS)[number];

/** The batch group of the emails about requests; its batch sends them (`src/server/jobs`). */
export const REQUEST_UPDATES_GROUP = 'request-updates';

/** One piece of news about a request for one person, who gets an email about it. */
const personNews = z.object({
  /** The request. */
  requestId: z.uuid(),
  /** The person to tell. */
  userId: z.uuid(),
  /** What happened. */
  event: z.enum(REQUEST_UPDATE_EVENTS),
  /**
   * The entry of the request's history it's about: the reply, the note,
   * the status change, the assignment, or the reply or note that mentions
   * them. `null` for a mention in the description, for being subscribed,
   * and for a request raised for them.
   */
  entryId: z.uuid().nullable(),
  /**
   * Who did it, where no entry says so: who wrote the mention into the
   * description, subscribed them, or raised the request for them. `null`
   * otherwise.
   */
  byUserId: z.uuid().nullable(),
});

/** One piece of news about a request for a webhook, which gets a delivery about it. */
const webhookNews = z.object({
  /** The request. */
  requestId: z.uuid(),
  /** The webhook to tell. */
  webhookId: z.uuid(),
  /**
   * The request type that made the webhook hear of it (for a change of type,
   * the old or the new one), so a webhook that no longer covers it by the time
   * it's sent isn't told.
   */
  typeKey: z.string(),
  /** What happened (`WEBHOOK_EVENTS`). */
  event: z.enum(WEBHOOK_EVENTS),
  /** The entry of the request's history it's about; `null` for the request being raised. */
  entryId: z.uuid().nullable(),
});

/** A piece of news for a webhook, as it's queued. */
export type WebhookNewsPayload = z.infer<typeof webhookNews>;

/**
 * Whether a piece of news is for a webhook rather than a person.
 *
 * @param payload - A job's payload.
 * @returns Whether it names a webhook.
 */
export function isWebhookNews(
  payload: z.infer<typeof personNews> | WebhookNewsPayload,
): payload is WebhookNewsPayload {
  return 'webhookId' in payload;
}

/** One piece of news about a request for one recipient: queue it in the transaction of the change. */
export const requestUpdateJob = defineQueuedKind({
  name: 'request-update',
  payload: z.union([personNews, webhookNews]),
  batch: {
    group: REQUEST_UPDATES_GROUP,
    /**
     * Everything for one recipient about one request goes into one email,
     * or one delivery to a webhook.
     *
     * @param payload - A job's payload.
     * @returns The key.
     */
    key: (payload) =>
      isWebhookNews(payload)
        ? `${payload.requestId}:webhook:${payload.webhookId}`
        : `${payload.requestId}:${payload.userId}`,
  },
});
