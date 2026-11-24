/**
 * @file News about a request for the people on it: who is told what, and
 * what one person's email about it may show. The emails themselves are sent
 * by the background jobs (`request-update`, `src/server/jobs`).
 *
 * - **Who is told:** a reply and a status change go to the people on the
 *   request, its assignees and subscribers, never the one who did it
 *   ({@link tellPeopleOnRequest}). An internal note goes only to the staff
 *   on it and the staff it mentions ({@link tellStaffOnRequest}): nobody at
 *   the company is ever told about a note, which the email checks again
 *   when it's read. Being put on a request goes to the one
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

import type { Database, DatabaseTransaction } from '@/db';
import {
  company,
  membership,
  request,
  requestEntry,
  requestMention,
  requestParticipant,
  user,
} from '@/db/schema';
import {
  getPermissions,
  getStaffPermissionsInCompanies,
  type Permission,
} from '@/lib/authz/permissions';
import type { CompanyRole, PlatformRole } from '@/lib/authz/roles';
import { visibleName } from '@/lib/display-name';
import {
  DESCRIPTION_ANCHOR,
  entryAnchor,
  formatRequestNumber,
  isRequestStatus,
  mayAnswerSolution,
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
import { queueJobs, requestUpdateJob, type RequestUpdateEvent } from '../queue';
import { loadPeopleOn } from './participants';
import currentProposalEntryId from './proposals';

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
 * @param about.request.companyId - Its company.
 * @param about.actorId - Who wrote the note: they aren't told about it.
 * @param entryId - The note.
 * @param mentioned - The people the note mentions.
 * @returns How many people it's queued for.
 */
export async function tellStaffOnRequest(
  tx: DatabaseTransaction,
  about: { request: { id: string; companyId: string }; actorId: string },
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
      /** Someone wrote an internal note: only ever for a reader who reads notes. */
      event: 'note';
      /** Who. */
      by: string;
      /** The note. */
      text: RequestUpdateText;
    }
  | {
      /** Someone changed the status. */
      event: 'status';
      /** Who. */
      by: string;
      /** The side they changed it as: the company's answer to a solution reads differently. */
      bySide: RequestSide;
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
      /** Where: in the request's description, a reply, or an internal note (for the staff). */
      where: 'description' | 'reply' | 'note';
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
  /**
   * Where on the request's page the email's link opens: the anchor of the
   * first news it tells of that has a place there (an entry of the activity,
   * `#entry-<ID>`, or the description for a mention in it), or `null` when
   * none has one (being subscribed leaves no entry).
   */
  anchor: string | null;
  /**
   * The proposal the reader may answer from the email (Approve and Deny,
   * decision 0033): only when the news includes the change that made the
   * request wait for approval, the request still waits for that proposal,
   * and the reader may answer it (`mayAnswerSolution`).
   */
  answerable?: { proposalEntryId: string };
  /** The jobs whose news isn't in the email, because what they were about is gone. */
  skipped: string[];
}

/**
 * Loads the request an email is about, with its company.
 *
 * @param db - Database client.
 * @param requestId - The request.
 * @returns The request, or `undefined` when it's gone.
 */
async function loadNewsRequest(db: Database, requestId: string) {
  const [found] = await db
    .select({
      number: request.number,
      title: request.title,
      description: request.description,
      descriptionFormat: request.descriptionFormat,
      companyId: request.companyId,
      status: request.status,
      companyName: company.name,
      companyDeactivatedAt: company.deactivatedAt,
    })
    .from(request)
    .innerJoin(company, eq(company.id, request.companyId))
    .where(eq(request.id, requestId));
  return found;
}

/** The request an email is about, as {@link loadNewsRequest} loads it. */
type NewsRequest = NonNullable<Awaited<ReturnType<typeof loadNewsRequest>>>;

/**
 * Loads the reader of an email about a request, and whoever did something
 * no entry names them for, each with their role in the request's company.
 *
 * @param db - Database client.
 * @param companyId - The request's company.
 * @param userIds - The reader's ID, then the others'.
 * @returns Their rows, in no order; nobody whose account is gone.
 */
function loadNewsPeople(db: Database, companyId: string, userIds: readonly string[]) {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      locale: user.locale,
      requestEmails: user.requestEmails,
      platformRole: user.platformRole,
      deactivatedAt: user.deactivatedAt,
      companyRole: membership.role,
    })
    .from(user)
    .leftJoin(membership, and(eq(membership.userId, user.id), eq(membership.companyId, companyId)))
    .where(inArray(user.id, [...userIds]));
}

/** Someone an email about a request names or goes to, as {@link loadNewsPeople} loads them. */
type NewsPerson = Awaited<ReturnType<typeof loadNewsPeople>>[number];

/**
 * Someone's permissions in a request's company, as they are now.
 *
 * @param person - Their roles.
 * @param person.platformRole - Their staff role, if they have one.
 * @param person.companyRole - Their role in the company, if they're in it.
 * @param found - The request.
 * @param found.companyDeactivatedAt - When its company was deactivated, or `null`.
 * @returns The permissions.
 */
function permissionsInCompanyOf(
  person: { platformRole: PlatformRole | null; companyRole: CompanyRole | null },
  found: { companyDeactivatedAt: Date | null },
): Set<Permission> {
  return getPermissions({
    platformRole: person.platformRole,
    companyRole: person.companyRole,
    company: { deactivated: found.companyDeactivatedAt !== null },
  });
}

/** Who an email about a request goes to, and what they may be told. */
interface NewsReader {
  /** The reader. */
  reader: NewsPerson;
  /** Their permissions in the request's company, as they are now. */
  permissions: Set<Permission>;
  /** Whether they read internal notes (`requests:view-internal`): only the staff do. */
  readsNotes: boolean;
  /** Whether the request is assigned to them. */
  assigned: boolean;
  /** Whether they're subscribed to it. */
  subscribed: boolean;
  /** The reader, and whoever did something no entry names them for. */
  people: NewsPerson[];
}

/**
 * Works out whether someone gets an email about a request now: not when
 * their account is deactivated, they turned emails about requests off in
 * their account (a row from before the setting existed counts as on), they
 * can no longer read the request, or they're no longer on it.
 *
 * @param db - Database client.
 * @param found - The request.
 * @param about - Whose email, about which request.
 * @param about.requestId - The request.
 * @param about.userId - The person.
 * @param news - Their queued news about it.
 * @returns The reader, or `null` when they get no email.
 */
async function newsReader(
  db: Database,
  found: NewsRequest,
  about: { requestId: string; userId: string },
  news: readonly QueuedRequestNews[],
): Promise<NewsReader | null> {
  const byUserIds = [...new Set(news.flatMap(({ byUserId }) => (byUserId ? [byUserId] : [])))];
  const [people, roles] = await Promise.all([
    loadNewsPeople(db, found.companyId, [about.userId, ...byUserIds]),
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
  const reader = people.find(({ id }) => id === about.userId);
  // Turned off in their account (a row from before the setting existed counts as on).
  if (
    !reader ||
    reader.deactivatedAt !== null ||
    reader.requestEmails === false ||
    roles.length === 0
  ) {
    return null;
  }
  const permissions = permissionsInCompanyOf(reader, found);
  if (!permissions.has('requests:view')) {
    return null;
  }
  return {
    reader,
    permissions,
    // Only the staff read internal notes: for anyone else a note, or a mention in one, is left out.
    readsNotes: permissions.has('requests:view-internal'),
    assigned: roles.some(({ role }) => role === 'assignee'),
    subscribed: roles.some(({ role }) => role === 'subscriber'),
    people,
  };
}

/**
 * Loads the entries of a request's history that news is about, with their
 * authors' names.
 *
 * @param db - Database client.
 * @param requestId - The request.
 * @param entryIds - The entries; none is loaded for none.
 * @returns Their rows, in no order; none that's gone.
 */
function loadNewsEntries(db: Database, requestId: string, entryIds: readonly string[]) {
  return entryIds.length === 0
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
        .where(and(eq(requestEntry.requestId, requestId), inArray(requestEntry.id, [...entryIds])));
}

/**
 * Loads the mentions of the texts news is about: the description's, which
 * have no entry, and those of the entries.
 *
 * @param db - Database client.
 * @param requestId - The request.
 * @param entryIds - The entries.
 * @returns Their rows, with the names of the people mentioned.
 */
function loadNewsMentions(db: Database, requestId: string, entryIds: readonly string[]) {
  return db
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
        eq(requestMention.requestId, requestId),
        entryIds.length === 0
          ? isNull(requestMention.entryId)
          : or(isNull(requestMention.entryId), inArray(requestMention.entryId, [...entryIds])),
      ),
    );
}

/** What the items of one person's email about a request are read from. */
interface NewsContext {
  /** The request. */
  found: NewsRequest;
  /** Who the email goes to, and what they may be told. */
  told: NewsReader;
  /** The entries the news is about, by ID. */
  entries: Map<string, Awaited<ReturnType<typeof loadNewsEntries>>[number]>;
  /** The mentions of the texts the news is about. */
  mentions: Awaited<ReturnType<typeof loadNewsMentions>>;
  /** The names that stand in for someone without one: the company's, and the staff's. */
  sideNames: Record<RequestSide, string>;
}

/**
 * The name the request's page gives someone: their own, or their side's.
 *
 * @param context - What the email is read from.
 * @param name - Their name, or `null` when their account is gone.
 * @param side - The side they acted as.
 * @returns The name to show.
 */
function pageName(context: NewsContext, name: string | null, side: RequestSide): string {
  return visibleName(name) ?? context.sideNames[side];
}

/**
 * The name of whoever did something no entry names them for. Someone whose
 * account is gone since is named as the company: only the staff's side is
 * something an account has to prove.
 *
 * @param context - What the email is read from.
 * @param userId - Their user ID.
 * @returns The name to show.
 */
function pageNameById(context: NewsContext, userId: string | null): string {
  const person = context.told.people.find(({ id }) => id === userId);
  return person
    ? pageName(context, person.name, requestSide(permissionsInCompanyOf(person, context.found)))
    : context.sideNames.company;
}

/**
 * A text of the request with the people it mentions by name.
 *
 * @param context - What the email is read from.
 * @param text - The text, as it's stored.
 * @param format - The format it's stored in.
 * @param entryId - The reply the text is; `null` for the description.
 * @returns The text for the email.
 */
function updateText(
  context: NewsContext,
  text: string,
  format: RequestTextFormat,
  entryId: string | null,
): RequestUpdateText {
  return {
    text,
    format,
    mentions: Object.fromEntries(
      context.mentions
        .filter((mention) => mention.entryId === entryId)
        .map((mention) => [mention.id, pageName(context, mention.name, mention.side)]),
    ),
  };
}

/**
 * Whether a text still mentions the reader: an edit may have taken the mention out.
 *
 * @param context - What the email is read from.
 * @param entryId - The reply the text is; `null` for the description.
 * @returns Whether it does.
 */
function mentionsReader(context: NewsContext, entryId: string | null): boolean {
  return context.mentions.some(
    (mention) => mention.entryId === entryId && mention.userId === context.told.reader.id,
  );
}

/**
 * What one piece of news tells, as it is by now.
 *
 * @param context - What the email is read from.
 * @param piece - The news.
 * @param piece.event - What happened.
 * @param piece.entryId - The entry it's about, if it has one.
 * @param piece.byUserId - Who did it, where no entry says so.
 * @returns The item for the email, or `null` when it's no longer true.
 */
function itemOf(
  context: NewsContext,
  { event, entryId, byUserId }: QueuedRequestNews,
): RequestUpdateItem | null {
  const { found, told } = context;
  const entry = entryId === null ? undefined : context.entries.get(entryId);
  const by = entry
    ? pageName(context, entry.authorName, entry.authorSide)
    : pageNameById(context, byUserId);
  if (event === 'reply' && entry?.kind === 'comment' && entry.body !== null) {
    return { event, by, text: updateText(context, entry.body, entry.bodyFormat, entry.id) };
  }
  if (event === 'note' && told.readsNotes && entry?.kind === 'note' && entry.body !== null) {
    return { event, by, text: updateText(context, entry.body, entry.bodyFormat, entry.id) };
  }
  if (
    event === 'status' &&
    entry?.kind === 'status' &&
    isRequestStatus(entry.from) &&
    isRequestStatus(entry.to)
  ) {
    return { event, by, bySide: entry.authorSide, from: entry.from, to: entry.to };
  }
  if (
    event === 'assigned' &&
    told.assigned &&
    entry?.kind === 'assignee' &&
    entry.to === 'assigned' &&
    entry.subjectUserId === told.reader.id
  ) {
    return { event, by };
  }
  if (event === 'mentioned' && mentionsReader(context, entryId)) {
    if (entryId === null) {
      return {
        event,
        by,
        where: 'description',
        text: updateText(context, found.description, found.descriptionFormat, null),
      };
    }
    if (entry?.kind === 'comment' && entry.body !== null) {
      return {
        event,
        by,
        where: 'reply',
        text: updateText(context, entry.body, entry.bodyFormat, entry.id),
      };
    }
    if (told.readsNotes && entry?.kind === 'note' && entry.body !== null) {
      return {
        event,
        by,
        where: 'note',
        text: updateText(context, entry.body, entry.bodyFormat, entry.id),
      };
    }
  }
  if (event === 'subscribed' && told.subscribed) {
    return { event, by };
  }
  return null;
}

/**
 * Where a piece of news has its place on the request's page.
 *
 * @param piece - The news.
 * @param item - What the email tells of it.
 * @returns Its anchor, or `null` when it has none.
 */
function anchorOf(piece: QueuedRequestNews, item: RequestUpdateItem): string | null {
  if (item.event === 'mentioned' && item.where === 'description') {
    return DESCRIPTION_ANCHOR;
  }
  return item.event === 'subscribed' || piece.entryId === null ? null : entryAnchor(piece.entryId);
}

/**
 * Turns one person's queued news into what their email tells, in the order
 * it was queued. The same news queued twice (a job that ran but couldn't be
 * noted as done) is told once, a reply or note that's told as a mention of
 * the reader isn't told again on its own, and news that's no longer true is
 * left out.
 *
 * @param context - What the email is read from.
 * @param news - The queued news.
 * @returns The items, the anchor of the first that has a place on the page, and the jobs of
 *   the news left out.
 */
function tellNews(
  context: NewsContext,
  news: readonly QueuedRequestNews[],
): Pick<RequestUpdate, 'items' | 'anchor' | 'skipped'> {
  // A reply that mentions the reader is told as the mention.
  const mentionedIn = new Set(
    news.flatMap(({ event, entryId }) => (event === 'mentioned' && entryId ? [entryId] : [])),
  );
  const told = new Set<string>();
  const skipped: string[] = [];
  const items: RequestUpdateItem[] = [];
  let anchor: string | null = null;
  // Job IDs are in the order the news was queued.
  [...news]
    .sort((a, b) => a.jobId.localeCompare(b.jobId))
    .forEach((piece) => {
      const key = `${piece.event}:${piece.entryId ?? ''}`;
      if (
        told.has(key) ||
        ((piece.event === 'reply' || piece.event === 'note') &&
          piece.entryId !== null &&
          mentionedIn.has(piece.entryId))
      ) {
        return;
      }
      const item = itemOf(context, piece);
      if (item === null) {
        skipped.push(piece.jobId);
        return;
      }
      told.add(key);
      items.push(item);
      anchor ??= anchorOf(piece, item);
    });
  return { items, anchor, skipped };
}

/**
 * Reads what one person's email about a request may show, when it's sent.
 * They get nothing when their account is deactivated, they turned emails
 * about requests off in their account, they can no longer read the request,
 * or they're no longer on it (unassigned, unsubscribed): only the people on
 * a request are told about it.
 *
 * People are named as the request's page names them (their own name, or
 * their side's: the company's, or the staff's), and the statuses are worded
 * for the reader (`audience`). News that's no longer true is left out: an
 * entry that's gone, an assignment that was taken back, a mention an edit
 * removed. A reply that mentions the reader is told once, as the mention,
 * and the same news queued twice is told once. An internal note, or a
 * mention in one, is told only to a reader who reads notes
 * (`requests:view-internal`): for anyone else it's left out, whatever
 * queued it, so nobody at the company hears of a note.
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
  const found = await loadNewsRequest(db, about.requestId);
  if (!found) {
    return null;
  }
  const told = await newsReader(db, found, about, news);
  if (!told) {
    return null;
  }
  const entryIds = [...new Set(news.flatMap(({ entryId }) => (entryId ? [entryId] : [])))];
  const [entries, mentions, staffName, prefix] = await Promise.all([
    loadNewsEntries(db, about.requestId, entryIds),
    loadNewsMentions(db, about.requestId, entryIds),
    getStaffName(db),
    getRequestPrefix(db),
  ]);
  const { items, anchor, skipped } = tellNews(
    {
      found,
      told,
      entries: new Map(entries.map((entry) => [entry.id, entry])),
      mentions,
      sideNames: { company: found.companyName, staff: staffName },
    },
    news,
  );
  if (items.length === 0) {
    return null;
  }
  // The email answers a proposal it tells of, while the request still waits for that one.
  const proposalEntryId = mayAnswerSolution(told.permissions, found.status)
    ? await currentProposalEntryId(db, about.requestId)
    : null;
  const tellsProposal = news.some(
    ({ event, entryId }) => event === 'status' && entryId !== null && entryId === proposalEntryId,
  );
  return {
    recipient: { email: told.reader.email, locale: told.reader.locale },
    role: told.assigned ? 'assignee' : 'subscriber',
    audience: requestAudience(told.permissions, told.reader.companyRole !== null),
    request: {
      number: found.number,
      reference: formatRequestNumber(prefix, found.number),
      title: found.title,
      companyName: found.companyName,
    },
    items,
    anchor,
    ...(proposalEntryId && tellsProposal && { answerable: { proposalEntryId } }),
    skipped,
  };
}
