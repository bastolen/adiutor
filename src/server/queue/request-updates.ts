/**
 * @file The queued emails about requests (`request-update`): one job per
 * person to tell and piece of news, queued in the transaction of the change.
 * Jobs for the same request and person run together, so a reply and the
 * status change that came with it make one email. A payload holds IDs and
 * the kind of news only; the names and the text are read when it's sent.
 */
import { z } from 'zod';

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

/** One piece of news about a request for one person: queue it in the transaction of the change. */
export const requestUpdateJob = defineQueuedKind({
  name: 'request-update',
  payload: z.object({
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
  }),
  batch: {
    group: REQUEST_UPDATES_GROUP,
    /**
     * Everything for one person about one request goes into one email.
     *
     * @param payload - A job's payload.
     * @param payload.requestId - The request.
     * @param payload.userId - The person to tell.
     * @returns The key.
     */
    key: ({ requestId, userId }) => `${requestId}:${userId}`,
  },
});
