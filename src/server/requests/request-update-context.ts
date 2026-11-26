/**
 * @file What one person's email about a request is read from, when it's
 * sent: the request, whether they get an email now ({@link newsReader}), and
 * the entries, mentions and files their news is about, as they are by then.
 * Read by `readRequestUpdate` (`read-request-update.ts`).
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

import type { Database } from '@/db';
import {
  company,
  membership,
  request,
  requestAttachment,
  requestEntry,
  requestMention,
  requestParticipant,
  user,
} from '@/db/schema';
import {
  getInternalRequestPermissions,
  getPermissions,
  type Permission,
} from '@/lib/authz/permissions';
import type { CompanyRole, PlatformRole } from '@/lib/authz/roles';
import type { RequestSide } from '@/lib/requests';

import { membershipIn } from './participants';
import type { QueuedRequestNews } from './request-update';

/**
 * Loads the request an email is about, with its company (none for an
 * internal request).
 *
 * @param db - Database client.
 * @param requestId - The request.
 * @returns The request, or `undefined` when it's gone.
 */
export async function loadNewsRequest(db: Database, requestId: string) {
  const [found] = await db
    .select({
      number: request.number,
      title: request.title,
      description: request.description,
      descriptionFormat: request.descriptionFormat,
      createdBy: request.createdBy,
      createdOnBehalf: request.createdOnBehalf,
      companyId: request.companyId,
      status: request.status,
      companyName: company.name,
      companyDeactivatedAt: company.deactivatedAt,
    })
    .from(request)
    .leftJoin(company, eq(company.id, request.companyId))
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
 * @param companyId - The request's company; `null` for an internal request, where nobody has a
 *   role but the staff's.
 * @param userIds - The reader's ID, then the others'.
 * @returns Their rows, in no order; nobody whose account is gone.
 */
function loadNewsPeople(db: Database, companyId: string | null, userIds: readonly string[]) {
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
    .leftJoin(membership, membershipIn(companyId))
    .where(inArray(user.id, [...userIds]));
}

/** Someone an email about a request names or goes to, as {@link loadNewsPeople} loads them. */
type NewsPerson = Awaited<ReturnType<typeof loadNewsPeople>>[number];

/**
 * Someone's permissions in a request's company, as they are now; in an
 * internal request, those of their staff role alone.
 *
 * @param person - Their roles.
 * @param person.platformRole - Their staff role, if they have one.
 * @param person.companyRole - Their role in the company, if they're in it.
 * @param found - The request.
 * @param found.companyId - Its company; `null` for an internal request.
 * @param found.companyDeactivatedAt - When its company was deactivated, or `null`.
 * @returns The permissions.
 */
export function permissionsInCompanyOf(
  person: { platformRole: PlatformRole | null; companyRole: CompanyRole | null },
  found: { companyId: string | null; companyDeactivatedAt: Date | null },
): Set<Permission> {
  if (found.companyId === null) {
    return getInternalRequestPermissions(person);
  }
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
 * their account, they can no longer read the request, or they're no longer on it.
 *
 * @param db - Database client.
 * @param found - The request.
 * @param about - Whose email, about which request.
 * @param about.requestId - The request.
 * @param about.userId - The person.
 * @param news - Their queued news about it.
 * @returns The reader, or `null` when they get no email.
 */
export async function newsReader(
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
  // Turned off in their account.
  if (!reader || reader.deactivatedAt !== null || !reader.requestEmails || roles.length === 0) {
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
export function loadNewsEntries(db: Database, requestId: string, entryIds: readonly string[]) {
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
export function loadNewsMentions(db: Database, requestId: string, entryIds: readonly string[]) {
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

/**
 * Loads the files of the texts news is about that are still there: the
 * description's, which have no entry, and those of the entries.
 *
 * @param db - Database client.
 * @param requestId - The request.
 * @param entryIds - The entries.
 * @returns Their text, name and size, oldest first.
 */
export function loadNewsAttachments(db: Database, requestId: string, entryIds: readonly string[]) {
  return db
    .select({
      entryId: requestAttachment.entryId,
      name: requestAttachment.name,
      size: requestAttachment.size,
    })
    .from(requestAttachment)
    .where(
      and(
        eq(requestAttachment.requestId, requestId),
        isNull(requestAttachment.removedAt),
        entryIds.length === 0
          ? isNull(requestAttachment.entryId)
          : or(
              isNull(requestAttachment.entryId),
              inArray(requestAttachment.entryId, [...entryIds]),
            ),
      ),
    )
    .orderBy(requestAttachment.id);
}

/** What the items of one person's email about a request are read from. */
export interface NewsContext {
  /** The request. */
  found: NewsRequest;
  /** Who the email goes to, and what they may be told. */
  told: NewsReader;
  /** The entries the news is about, by ID. */
  entries: Map<string, Awaited<ReturnType<typeof loadNewsEntries>>[number]>;
  /** The mentions of the texts the news is about. */
  mentions: Awaited<ReturnType<typeof loadNewsMentions>>;
  /** The files of the texts the news is about. */
  attachments: Awaited<ReturnType<typeof loadNewsAttachments>>;
  /** The names that stand in for someone without one: the company's, and the staff's. */
  sideNames: Record<RequestSide, string>;
}
