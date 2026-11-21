/**
 * @file News about a request for the people on it: who is told what, and
 * what one person's email about it may show. The emails themselves are sent
 * by the background jobs (`request-update`, `src/server/jobs`).
 *
 * - **Who is told:** a reply and a status change go to the people on the
 *   request, its assignees and subscribers, never the one who did it
 *   ({@link tellPeopleOnRequest}). Being put on a request goes to the one
 *   it's about, unless they did it themselves: assigned
 *   ({@link tellAssigned}), mentioned in a text ({@link tellMentioned}) or
 *   subscribed by someone else ({@link tellSubscribed}). One job per person
 *   and piece of news is queued in the transaction of the change, so the
 *   news exists exactly when the change was saved.
 * - **What a person's email shows** is decided again when it's sent
 *   ({@link readRequestUpdate}): nothing for someone who is no longer on the
 *   request or can no longer read it, and people by the names the request's
 *   page gives them, never an address or an ID.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

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
import type { CompanyRole, PlatformRole } from '@/lib/authz/roles';
import { visibleName } from '@/lib/display-name';
import {
  formatRequestNumber,
  isRequestStatus,
  requestAudience,
  type RequestAudience,
  type RequestParticipantRole,
  requestSide,
  type RequestSide,
  type RequestStatus,
  type RequestTextFormat,
} from '@/lib/requests';

import type { ServiceContext } from '../context';
import getRequestPrefix from '../people/request-prefix';
import getStaffName from '../people/staff-name';
import { queueJob, requestUpdateJob, type RequestUpdateEvent } from '../queue';
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
 * Queues news, one job after another: a transaction runs one statement at a time.
 *
 * @param tx - The change's transaction.
 * @param jobs - The jobs.
 */
async function queueNews(tx: DatabaseTransaction, jobs: readonly NewsJob[]): Promise<void> {
  await jobs.reduce<Promise<void>>(async (queued, job) => {
    await queued;
    await queueJob(tx, requestUpdateJob, job);
  }, Promise.resolve());
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
 * @param about.request.companyId - Its company.
 * @param about.actorId - Who made the change: they aren't told about it.
 * @param news - What happened, in order.
 * @param mentioned - The people a reply among the news mentions.
 * @returns How many people it's queued for.
 */
export async function tellPeopleOnRequest(
  tx: DatabaseTransaction,
  about: { request: { id: string; companyId: string }; actorId: string },
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

/** A queued piece of news for one person, as the batch that sends it hands it over. */
export interface QueuedRequestNews {
  /** The queued job's ID. Job IDs are in the order the news was queued. */
  jobId: string;
  /** What happened. */
  event: RequestUpdateEvent;
  /** The entry it's about, if it has one. */
  entryId: string | null;
  /** Who did it, where no entry says so. */
  byUserId: string | null;
}

/** A text in an email about a request, with the people it mentions by name. */
export interface RequestUpdateText {
  /** The text, as it's stored. */
  text: string;
  /** The format it's stored in. */
  format: RequestTextFormat;
  /** The names of the people it mentions, by the ID its markers name. */
  mentions: Record<string, string>;
}

/** One thing an email about a request tells its reader. Each names who did it, as the request's page names them. */
export type RequestUpdateItem =
  | {
      /** Someone replied. */
      event: 'reply';
      /** Who. */
      by: string;
      /** The reply. */
      text: RequestUpdateText;
    }
  | {
      /** Someone changed the status. */
      event: 'status';
      /** Who. */
      by: string;
      /** The status it had. */
      from: RequestStatus;
      /** The status it got. */
      to: RequestStatus;
    }
  | {
      /** Someone assigned the request to the reader. */
      event: 'assigned';
      /** Who. */
      by: string;
    }
  | {
      /** Someone mentioned the reader. */
      event: 'mentioned';
      /** Who. */
      by: string;
      /** Where: in the request's description, or in a reply. */
      where: 'description' | 'reply';
      /** The text that mentions them. */
      text: RequestUpdateText;
    }
  | {
      /** Someone subscribed the reader to the request. */
      event: 'subscribed';
      /** Who. */
      by: string;
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
  /** What happened, in the order it was queued. */
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
 * for the reader (`audience`). News that's no longer true is left out: an
 * entry that's gone, an assignment that was taken back, a mention an edit
 * removed. A reply that mentions the reader is told once, as the mention,
 * and the same news queued twice is told once.
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
      description: request.description,
      descriptionFormat: request.descriptionFormat,
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
  const byUserIds = [...new Set(news.flatMap(({ byUserId }) => (byUserId ? [byUserId] : [])))];
  const [people, roles] = await Promise.all([
    // The reader, and whoever did something no entry names them for.
    db
      .select({
        id: user.id,
        name: user.name,
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
      .where(inArray(user.id, [about.userId, ...byUserIds])),
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
  /**
   * Someone's permissions in the request's company, as they are now.
   *
   * @param person - Their roles.
   * @param person.platformRole - Their staff role, if they have one.
   * @param person.companyRole - Their role in the company, if they're in it.
   * @returns The permissions.
   */
  const permissionsOf = (person: {
    platformRole: PlatformRole | null;
    companyRole: CompanyRole | null;
  }) =>
    getPermissions({
      platformRole: person.platformRole,
      companyRole: person.companyRole,
      company: { deactivated: found.companyDeactivatedAt !== null },
    });
  const reader = people.find(({ id }) => id === about.userId);
  if (!reader || reader.deactivatedAt !== null || roles.length === 0) {
    return null;
  }
  const permissions = permissionsOf(reader);
  if (!permissions.has('requests:view')) {
    return null;
  }
  const assigned = roles.some(({ role }) => role === 'assignee');
  const subscribed = roles.some(({ role }) => role === 'subscriber');

  const entryIds = [...new Set(news.flatMap(({ entryId }) => (entryId ? [entryId] : [])))];
  const [entries, mentions, staffName, prefix] = await Promise.all([
    entryIds.length === 0
      ? []
      : db
          .select({
            id: requestEntry.id,
            kind: requestEntry.kind,
            body: requestEntry.body,
            bodyFormat: requestEntry.bodyFormat,
            from: requestEntry.fromValue,
            to: requestEntry.toValue,
            subjectUserId: requestEntry.subjectUserId,
            authorSide: requestEntry.authorSide,
            authorName: user.name,
          })
          .from(requestEntry)
          .leftJoin(user, eq(requestEntry.authorId, user.id))
          .where(
            and(eq(requestEntry.requestId, about.requestId), inArray(requestEntry.id, entryIds)),
          ),
    // The mentions of the texts the news is about: the description's have no entry.
    db
      .select({
        id: requestMention.id,
        entryId: requestMention.entryId,
        userId: requestMention.userId,
        side: requestMention.side,
        name: user.name,
      })
      .from(requestMention)
      .leftJoin(user, eq(requestMention.userId, user.id))
      .where(
        and(
          eq(requestMention.requestId, about.requestId),
          entryIds.length === 0
            ? isNull(requestMention.entryId)
            : or(isNull(requestMention.entryId), inArray(requestMention.entryId, entryIds)),
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
  /**
   * The name of whoever did something no entry names them for. Someone whose
   * account is gone since is named as the company: only the staff's side
   * is something an account has to prove.
   *
   * @param userId - Their user ID.
   * @returns The name to show.
   */
  const namedById = (userId: string | null) => {
    const person = people.find(({ id }) => id === userId);
    return person ? named(person.name, requestSide(permissionsOf(person))) : sideNames.company;
  };
  /**
   * A text of the request with the people it mentions by name.
   *
   * @param text - The text, as it's stored.
   * @param format - The format it's stored in.
   * @param entryId - The reply the text is; `null` for the description.
   * @returns The text for the email.
   */
  const textOf = (
    text: string,
    format: RequestTextFormat,
    entryId: string | null,
  ): RequestUpdateText => ({
    text,
    format,
    mentions: Object.fromEntries(
      mentions
        .filter((mention) => mention.entryId === entryId)
        .map((mention) => [mention.id, named(mention.name, mention.side)]),
    ),
  });
  /**
   * Whether a text still mentions the reader: an edit may have taken the mention out.
   *
   * @param entryId - The reply the text is; `null` for the description.
   * @returns Whether it does.
   */
  const mentionsReader = (entryId: string | null) =>
    mentions.some((mention) => mention.entryId === entryId && mention.userId === about.userId);
  const entryOf = new Map(entries.map((entry) => [entry.id, entry]));
  // A reply that mentions the reader is told as the mention.
  const mentionedIn = new Set(
    news.flatMap(({ event, entryId }) => (event === 'mentioned' && entryId ? [entryId] : [])),
  );

  /**
   * What one piece of news tells, as it is by now.
   *
   * @param piece - The news.
   * @param piece.event - What happened.
   * @param piece.entryId - The entry it's about, if it has one.
   * @param piece.byUserId - Who did it, where no entry says so.
   * @returns The item for the email, or `null` when it's no longer true.
   */
  const itemOf = ({ event, entryId, byUserId }: QueuedRequestNews): RequestUpdateItem | null => {
    const entry = entryId === null ? undefined : entryOf.get(entryId);
    const by = entry ? named(entry.authorName, entry.authorSide) : namedById(byUserId);
    if (event === 'reply' && entry?.kind === 'comment' && entry.body !== null) {
      return { event, by, text: textOf(entry.body, entry.bodyFormat, entry.id) };
    }
    if (
      event === 'status' &&
      entry?.kind === 'status' &&
      isRequestStatus(entry.from) &&
      isRequestStatus(entry.to)
    ) {
      return { event, by, from: entry.from, to: entry.to };
    }
    if (
      event === 'assigned' &&
      assigned &&
      entry?.kind === 'assignee' &&
      entry.to === 'assigned' &&
      entry.subjectUserId === about.userId
    ) {
      return { event, by };
    }
    if (event === 'mentioned' && mentionsReader(entryId)) {
      if (entryId === null) {
        return {
          event,
          by,
          where: 'description',
          text: textOf(found.description, found.descriptionFormat, null),
        };
      }
      if (entry?.kind === 'comment' && entry.body !== null) {
        return { event, by, where: 'reply', text: textOf(entry.body, entry.bodyFormat, entry.id) };
      }
    }
    if (event === 'subscribed' && subscribed) {
      return { event, by };
    }
    return null;
  };

  const told = new Set<string>();
  const skipped: string[] = [];
  const items: RequestUpdateItem[] = [];
  // Job IDs are in the order the news was queued.
  [...news]
    .sort((a, b) => a.jobId.localeCompare(b.jobId))
    .forEach((piece) => {
      const key = `${piece.event}:${piece.entryId ?? ''}`;
      // The same news queued twice (a job that ran but couldn't be noted as done) is told once,
      // and a reply that's told as a mention isn't told again as a reply.
      if (
        told.has(key) ||
        (piece.event === 'reply' && piece.entryId !== null && mentionedIn.has(piece.entryId))
      ) {
        return;
      }
      const item = itemOf(piece);
      if (item === null) {
        skipped.push(piece.jobId);
        return;
      }
      told.add(key);
      items.push(item);
    });
  if (items.length === 0) {
    return null;
  }
  return {
    recipient: { email: reader.email, locale: reader.locale ?? null },
    role: assigned ? 'assignee' : 'subscriber',
    audience: requestAudience(permissions, reader.companyRole !== null),
    request: {
      number: found.number,
      reference: formatRequestNumber(prefix, found.number),
      title: found.title,
      companyName: found.companyName,
    },
    items,
    skipped,
  };
}
