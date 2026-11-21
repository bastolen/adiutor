/**
 * @file News about a request for the people on it: who is told what, and
 * what one person's email about it may show. The emails themselves are sent
 * by the background jobs (`request-update`, `src/server/jobs`).
 *
 * - **Who is told:** the people on the request, its assignees and
 *   subscribers, never the one who did it ({@link tellPeopleOnRequest}). One
 *   job per person and piece of news is queued in the transaction of the
 *   change, so the news exists exactly when the change was saved.
 * - **What a person's email shows** is decided again when it's sent
 *   ({@link readRequestUpdate}): nothing for someone who is no longer on the
 *   request or can no longer read it, and people by the names the request's
 *   page gives them, never an address or an ID.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import {
  company,
  membership,
  request,
  requestEntry,
  requestMention,
  requestParticipant,
  user,
} from '@/db/schema';
import { getPermissions } from '@/lib/authz/permissions';
import { visibleName } from '@/lib/display-name';
import {
  formatRequestNumber,
  isRequestStatus,
  requestAudience,
  type RequestAudience,
  type RequestParticipantRole,
  type RequestSide,
  type RequestStatus,
  type RequestTextFormat,
} from '@/lib/requests';

import type { ServiceContext } from '../context';
import getRequestPrefix from '../people/request-prefix';
import getStaffName from '../people/staff-name';
import { queueJob, requestUpdateJob, type RequestUpdateEvent } from '../queue';
import { loadSubscribers } from './subscribers';

/** A piece of news about a request, as a change queues it. */
export interface RequestNews {
  /** What happened. */
  event: RequestUpdateEvent;
  /** The entry of the request's history it's about. */
  entryId: string;
}

/**
 * Queues news about a request for everyone on it but whoever did it: its
 * assignees and its subscribers who can read it by now (`loadSubscribers`).
 * Call it in the transaction of the change, after the change itself (and
 * after `storeMentions`, so someone a reply mentions is on the request by
 * then).
 *
 * @param tx - The change's transaction.
 * @param about - The request, and who made the change.
 * @param about.request - The request.
 * @param about.request.id - Its ID.
 * @param about.request.companyId - Its company.
 * @param about.actorId - Who made the change: they aren't told about it.
 * @param news - What happened, in order.
 * @returns How many people it's queued for.
 */
export async function tellPeopleOnRequest(
  tx: DatabaseTransaction,
  about: { request: { id: string; companyId: string }; actorId: string },
  news: readonly RequestNews[],
): Promise<number> {
  if (news.length === 0) {
    return 0;
  }
  const assignees = await tx
    .select({ id: user.id })
    .from(requestParticipant)
    .innerJoin(user, eq(requestParticipant.userId, user.id))
    .where(
      and(
        eq(requestParticipant.requestId, about.request.id),
        eq(requestParticipant.role, 'assignee'),
        isNull(user.deactivatedAt),
      ),
    );
  const subscribers = await loadSubscribers(tx, about.request);
  const people = new Set([...assignees, ...subscribers].map(({ id }) => id));
  people.delete(about.actorId);
  const jobs = [...people].flatMap((userId) =>
    news.map(({ event, entryId }) => ({ requestId: about.request.id, userId, event, entryId })),
  );
  // One after another: a transaction runs one statement at a time.
  await jobs.reduce<Promise<void>>(async (queued, job) => {
    await queued;
    await queueJob(tx, requestUpdateJob, job);
  }, Promise.resolve());
  return people.size;
}

/** A queued piece of news for one person, as the batch that sends it hands it over. */
export interface QueuedRequestNews extends RequestNews {
  /** The queued job's ID. */
  jobId: string;
}

/** A text in an email about a request: a reply, with the people it mentions by name. */
export interface RequestUpdateText {
  /** The text, as it's stored. */
  text: string;
  /** The format it's stored in. */
  format: RequestTextFormat;
  /** The names of the people it mentions, by the ID its markers name. */
  mentions: Record<string, string>;
}

/** One thing an email about a request tells its reader. */
export type RequestUpdateItem =
  | {
      /** Someone replied. */
      event: 'reply';
      /** Who, by the name the request's page gives them. */
      by: string;
      /** The reply. */
      text: RequestUpdateText;
    }
  | {
      /** Someone changed the status. */
      event: 'status';
      /** Who, by the name the request's page gives them. */
      by: string;
      /** The status it had. */
      from: RequestStatus;
      /** The status it got. */
      to: RequestStatus;
    };

/** What one person's email about a request may show. */
export interface RequestUpdate {
  /** Where it goes, and the language its reader saved. */
  recipient: {
    /** Their email address: for sending only, never shown. */
    email: string;
    /** The language they saved, or `null` for Adiutor's default. */
    locale: string | null;
  };
  /** Why they get it: the request is assigned to them, or they're subscribed to it. */
  role: RequestParticipantRole;
  /** How to word the request's statuses for them. */
  audience: RequestAudience;
  /** The request. */
  request: {
    /** Its number, for its address. */
    number: number;
    /** Its number as people see it, e.g. "AD-142". */
    reference: string;
    /** Its title. */
    title: string;
    /** Its company's name. */
    companyName: string;
  };
  /** What happened, in the order it happened. */
  items: RequestUpdateItem[];
  /** The jobs whose news isn't in the email, because what they were about is gone. */
  skipped: string[];
}

/**
 * Reads what one person's email about a request may show, when it's sent.
 * They get nothing when their account is deactivated, they can no longer
 * read the request, or they're no longer on it (unassigned, unsubscribed):
 * only the people on a request are told about it.
 *
 * People are named as the request's page names them (their own name, or
 * their side's: the company's, or the staff's), and the statuses are worded
 * for the reader (`audience`). News whose entry is gone is left out; the
 * same news queued twice is told once.
 *
 * @param ctx - Service context.
 * @param about - Whose email, about which request.
 * @param about.requestId - The request.
 * @param about.userId - The person.
 * @param news - Their queued news about it.
 * @returns What to show, or `null` when they get no email.
 */
export async function readRequestUpdate(
  ctx: Pick<ServiceContext, 'db'>,
  about: { requestId: string; userId: string },
  news: readonly QueuedRequestNews[],
): Promise<RequestUpdate | null> {
  const { db } = ctx;
  const [found] = await db
    .select({
      number: request.number,
      title: request.title,
      companyId: request.companyId,
      companyName: company.name,
      companyDeactivatedAt: company.deactivatedAt,
    })
    .from(request)
    .innerJoin(company, eq(company.id, request.companyId))
    .where(eq(request.id, about.requestId));
  if (!found) {
    return null;
  }
  const [[reader], roles] = await Promise.all([
    db
      .select({
        email: user.email,
        locale: user.locale,
        platformRole: user.platformRole,
        deactivatedAt: user.deactivatedAt,
        companyRole: membership.role,
      })
      .from(user)
      .leftJoin(
        membership,
        and(eq(membership.userId, user.id), eq(membership.companyId, found.companyId)),
      )
      .where(eq(user.id, about.userId)),
    db
      .select({ role: requestParticipant.role })
      .from(requestParticipant)
      .where(
        and(
          eq(requestParticipant.requestId, about.requestId),
          eq(requestParticipant.userId, about.userId),
        ),
      ),
  ]);
  if (!reader || reader.deactivatedAt !== null || roles.length === 0) {
    return null;
  }
  const permissions = getPermissions({
    platformRole: reader.platformRole ?? null,
    companyRole: reader.companyRole ?? null,
    company: { deactivated: found.companyDeactivatedAt !== null },
  });
  if (!permissions.has('requests:view')) {
    return null;
  }

  const entryIds = [...new Set(news.map(({ entryId }) => entryId))];
  const [entries, mentioned, staffName, prefix] = await Promise.all([
    db
      .select({
        id: requestEntry.id,
        kind: requestEntry.kind,
        body: requestEntry.body,
        bodyFormat: requestEntry.bodyFormat,
        from: requestEntry.fromValue,
        to: requestEntry.toValue,
        authorSide: requestEntry.authorSide,
        authorName: user.name,
      })
      .from(requestEntry)
      .leftJoin(user, eq(requestEntry.authorId, user.id))
      .where(and(eq(requestEntry.requestId, about.requestId), inArray(requestEntry.id, entryIds))),
    db
      .select({
        id: requestMention.id,
        entryId: requestMention.entryId,
        side: requestMention.side,
        name: user.name,
      })
      .from(requestMention)
      .leftJoin(user, eq(requestMention.userId, user.id))
      .where(
        and(
          eq(requestMention.requestId, about.requestId),
          inArray(requestMention.entryId, entryIds),
        ),
      ),
    getStaffName(db),
    getRequestPrefix(db),
  ]);
  const sideNames: Record<RequestSide, string> = { company: found.companyName, staff: staffName };
  /**
   * The name the request's page gives someone: their own, or their side's.
   *
   * @param name - Their name, or `null` when their account is gone.
   * @param side - The side they acted as.
   * @returns The name to show.
   */
  const named = (name: string | null, side: RequestSide) => visibleName(name) ?? sideNames[side];
  const entryOf = new Map(entries.map((entry) => [entry.id, entry]));

  const told = new Set<string>();
  const skipped: string[] = [];
  const items: { entryId: string; item: RequestUpdateItem }[] = [];
  news.forEach(({ jobId, event, entryId }) => {
    // The same news queued twice (a job that ran but couldn't be noted as done) is told once.
    if (told.has(`${event}:${entryId}`)) {
      return;
    }
    const entry = entryOf.get(entryId);
    const by = entry ? named(entry.authorName, entry.authorSide) : '';
    if (event === 'reply' && entry?.kind === 'comment' && entry.body !== null) {
      told.add(`${event}:${entryId}`);
      items.push({
        entryId,
        item: {
          event,
          by,
          text: {
            text: entry.body,
            format: entry.bodyFormat,
            mentions: Object.fromEntries(
              mentioned
                .filter((mention) => mention.entryId === entryId)
                .map((mention) => [mention.id, named(mention.name, mention.side)]),
            ),
          },
        },
      });
    } else if (
      event === 'status' &&
      entry?.kind === 'status' &&
      isRequestStatus(entry.from) &&
      isRequestStatus(entry.to)
    ) {
      told.add(`${event}:${entryId}`);
      items.push({ entryId, item: { event, by, from: entry.from, to: entry.to } });
    } else {
      skipped.push(jobId);
    }
  });
  if (items.length === 0) {
    return null;
  }
  return {
    recipient: { email: reader.email, locale: reader.locale ?? null },
    role: roles.some(({ role }) => role === 'assignee') ? 'assignee' : 'subscriber',
    audience: requestAudience(permissions, reader.companyRole !== null),
    request: {
      number: found.number,
      reference: formatRequestNumber(prefix, found.number),
      title: found.title,
      companyName: found.companyName,
    },
    // Entry IDs are in the order the entries were written.
    items: items.sort((a, b) => a.entryId.localeCompare(b.entryId)).map(({ item }) => item),
    skipped,
  };
}
