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
 * (`reply`), or changed its status (`status`).
 */
export const REQUEST_UPDATE_EVENTS = ['reply', 'status'] as const;

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
    /** The entry of the request's history it's about: the reply, or the status change. */
    entryId: z.uuid(),
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
