/**
 * @file Who is told about what happens to a request: the one place that
 * decides it (decision 0031), beside `tellWebhooks` for the webhooks. A reply
 * and a status change go to the people on the request, its assignees and
 * subscribers, never the one who did it ({@link tellPeopleOnRequest}). An
 * internal note goes only to the staff on it and the staff it mentions
 * ({@link tellStaffOnRequest}, decision 0032): nobody at the company is ever
 * told about a note, which the email checks again when it's read
 * (`readRequestUpdate`). Being put on a request goes to the one it's about,
 * unless they did it themselves: assigned ({@link tellAssigned}), mentioned in
 * a text ({@link tellMentioned}), subscribed by someone else
 * ({@link tellSubscribed}) or having it raised for them by a staff member
 * ({@link tellRaisedFor}). One job per person and piece of news is queued in
 * the transaction of the change, so the news exists exactly when the change
 * was saved. The emails themselves are sent by the background jobs
 * (`request-update`, `src/server/jobs`).
 */
import { inArray } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import { user } from '@/db/schema';
import { getStaffPermissionsInCompanies } from '@/lib/authz/permissions';

import { queueJobs, requestUpdateJob, type RequestUpdateEvent } from '../queue';
import { loadPeopleOn } from './participants';

/** A reply or a status change, as the change that made it queues it for the people on the request. */
export interface RequestNews {
  /** What happened. */
  event: 'reply' | 'status';
  /** The entry of the request's history it's about. */
  entryId: string;
}

/** One job to queue: a piece of news for one person. */
interface NewsJob {
  /** The request. */
  requestId: string;
  /** The person to tell. */
  userId: string;
  /** What happened. */
  event: RequestUpdateEvent;
  /** The entry it's about, if it has one. */
  entryId: string | null;
  /** Who did it, where no entry says so. */
  byUserId: string | null;
}

/**
 * Queues news, in the order given, in one statement: the change's transaction
 * holds the request's row lock meanwhile, and a request many people follow
 * would otherwise take one statement for each of them.
 *
 * @param tx - The change's transaction.
 * @param jobs - The jobs.
 */
async function queueNews(tx: DatabaseTransaction, jobs: readonly NewsJob[]): Promise<void> {
  await queueJobs(tx, requestUpdateJob, jobs);
}

/**
 * Queues a reply or a status change for everyone on the request but whoever
 * did it: its assignees and its subscribers who can read it by now
 * (`loadPeopleOn`). Call it in the transaction of the change, after the
 * change itself and after `storeMentions`, so someone a reply mentions is on
 * the request by then. For them the reply is told as a mention of them.
 *
 * @param tx - The change's transaction.
 * @param about - The request, and who made the change.
 * @param about.request - The request.
 * @param about.request.id - Its ID.
 * @param about.request.companyId - Its company; `null` for an internal request.
 * @param about.actorId - Who made the change: they aren't told about it.
 * @param news - What happened, in order.
 * @param mentioned - The people a reply among the news mentions.
 * @returns How many people it's queued for.
 */
export async function tellPeopleOnRequest(
  tx: DatabaseTransaction,
  about: { request: { id: string; companyId: string | null }; actorId: string },
  news: readonly RequestNews[],
  mentioned: readonly string[] = [],
): Promise<number> {
  if (news.length === 0) {
    return 0;
  }
  const people = (await loadPeopleOn(tx, about.request)).filter(
    (userId) => userId !== about.actorId,
  );
  await queueNews(
    tx,
    people.flatMap((userId) =>
      news.map(({ event, entryId }) =>
        event === 'reply' && mentioned.includes(userId)
          ? {
              requestId: about.request.id,
              userId,
              event: 'mentioned' as const,
              entryId,
              byUserId: about.actorId,
            }
          : { requestId: about.request.id, userId, event, entryId, byUserId: null },
      ),
    ),
  );
  return people.length;
}

/**
 * Keeps the staff who read internal notes (`requests:view-internal`) out of a
 * list of people: an internal note is told to them, and to nobody else.
 *
 * @param tx - The change's transaction.
 * @param userIds - The people.
 * @returns Those of them who read notes as staff, each once.
 */
export async function staffWhoReadNotes(
  tx: DatabaseTransaction,
  userIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) {
    return [];
  }
  const people = await tx
    .select({ id: user.id, platformRole: user.platformRole })
    .from(user)
    .where(inArray(user.id, ids));
  return people
    .filter((person) =>
      getStaffPermissionsInCompanies({ platformRole: person.platformRole }).has(
        'requests:view-internal',
      ),
    )
    .map(({ id }) => id);
}

/**
 * Queues an internal note for the staff on the request (its assignees and its
 * subscribers who read notes) and the staff it mentions, never whoever wrote
 * it, and never anyone at the company: a mention in a note of someone at the
 * company tells them nothing. Someone it mentions is told of the note as a
 * mention of them. Call it in the transaction of the note, after
 * `storeMentions`.
 *
 * @param tx - The change's transaction.
 * @param about - The request, and who wrote the note.
 * @param about.request - The request.
 * @param about.request.id - Its ID.
 * @param about.request.companyId - Its company; `null` for an internal request.
 * @param about.actorId - Who wrote the note: they aren't told about it.
 * @param entryId - The note.
 * @param mentioned - The people the note mentions.
 * @returns How many people it's queued for.
 */
export async function tellStaffOnRequest(
  tx: DatabaseTransaction,
  about: { request: { id: string; companyId: string | null }; actorId: string },
  entryId: string,
  mentioned: readonly string[] = [],
): Promise<number> {
  const onRequest = await loadPeopleOn(tx, about.request);
  const staff = (await staffWhoReadNotes(tx, [...onRequest, ...mentioned])).filter(
    (userId) => userId !== about.actorId,
  );
  await queueNews(
    tx,
    staff.map((userId) =>
      mentioned.includes(userId)
        ? {
            requestId: about.request.id,
            userId,
            event: 'mentioned' as const,
            entryId,
            byUserId: about.actorId,
          }
        : { requestId: about.request.id, userId, event: 'note' as const, entryId, byUserId: null },
    ),
  );
  return staff.length;
}

/**
 * Queues, for the people a text mentions, that they're mentioned: in a new
 * request's description, or in a text an edit added the mention to. (A new
 * reply's mentions go with the reply: {@link tellPeopleOnRequest}.) Call it
 * after `storeMentions`, with who it mentioned.
 *
 * @param tx - The change's transaction.
 * @param about - The text, and who wrote the mention.
 * @param about.requestId - The request.
 * @param about.entryId - The reply the text is; `null` for the request's description.
 * @param about.actorId - Who wrote the mention: they aren't told.
 * @param mentioned - The people the text mentions newly.
 */
export async function tellMentioned(
  tx: DatabaseTransaction,
  about: { requestId: string; entryId: string | null; actorId: string },
  mentioned: readonly string[],
): Promise<void> {
  await queueNews(
    tx,
    [...new Set(mentioned)]
      .filter((userId) => userId !== about.actorId)
      .map((userId) => ({
        requestId: about.requestId,
        userId,
        event: 'mentioned' as const,
        entryId: about.entryId,
        byUserId: about.actorId,
      })),
  );
}

/**
 * Queues, for staff members someone else assigned a request to, that it's
 * assigned to them.
 *
 * @param tx - The change's transaction.
 * @param about - The request, and who assigned it.
 * @param about.requestId - The request.
 * @param about.actorId - Who assigned it: assigning it to themselves is no news to them.
 * @param assigned - The people it was assigned to, each with the entry that says so.
 */
export async function tellAssigned(
  tx: DatabaseTransaction,
  about: { requestId: string; actorId: string },
  assigned: readonly { userId: string; entryId: string }[],
): Promise<void> {
  await queueNews(
    tx,
    assigned
      .filter(({ userId }) => userId !== about.actorId)
      .map(({ userId, entryId }) => ({
        requestId: about.requestId,
        userId,
        event: 'assigned' as const,
        entryId,
        byUserId: null,
      })),
  );
}

/**
 * Queues, for people someone else subscribed to a request, that they follow
 * it now.
 *
 * @param tx - The change's transaction.
 * @param about - The request, and who subscribed them.
 * @param about.requestId - The request.
 * @param about.actorId - Who subscribed them: subscribing themselves is no news to them.
 * @param subscribed - The people who were subscribed.
 */
export async function tellSubscribed(
  tx: DatabaseTransaction,
  about: { requestId: string; actorId: string },
  subscribed: readonly string[],
): Promise<void> {
  await queueNews(
    tx,
    subscribed
      .filter((userId) => userId !== about.actorId)
      .map((userId) => ({
        requestId: about.requestId,
        userId,
        event: 'subscribed' as const,
        entryId: null,
        byUserId: about.actorId,
      })),
  );
}

/**
 * Queues, for someone at the company a staff member raised a request for
 * (decision 0047), that it was raised for them. Their email shows the
 * description, so the mentions in it aren't told to them again.
 *
 * @param tx - The raising transaction.
 * @param about - The request, who raised it and who for.
 * @param about.requestId - The request.
 * @param about.actorId - The staff member who raised it.
 * @param about.raisedFor - Who they raised it for.
 */
export async function tellRaisedFor(
  tx: DatabaseTransaction,
  about: { requestId: string; actorId: string; raisedFor: string },
): Promise<void> {
  await queueNews(tx, [
    {
      requestId: about.requestId,
      userId: about.raisedFor,
      event: 'raised',
      entryId: null,
      byUserId: about.actorId,
    },
  ]);
}
