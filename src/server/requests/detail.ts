/**
 * @file One request as its readers see it: its details, who it's assigned
 * to, the company it's in, what the reader may do with it, and its
 * conversation.
 */
import { and, count, desc, eq, min, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { requestAssignee, requestEntry, user } from '@/db/schema';
import type { Permission } from '@/lib/authz/permissions';
import { firstRow } from '@/lib/defined';
import {
  parseRequestReference,
  type RequestAudience,
  type RequestEntryKind,
  type RequestPriority,
  type RequestStatus,
  type RequestTextFormat,
  type RequestType,
} from '@/lib/requests';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { orderTerms, textOrder } from '../pagination';
import getRequestPrefix from '../people/request-prefix';
import getStaffName from '../people/staff-name';
import { getRequestAccess, requestAudienceIn, type RequestPerson, requestPerson } from './access';

/** The account an `assignee` entry is about, joined next to its author's. */
const subjectUser = alias(user, 'subject_user');

/** How many entries of a request's history are loaded at a time: the latest ones first. */
export const THREAD_CHUNK = 50;

/** How many earlier chunks a reader can add to the latest one. */
export const MAX_EARLIER_CHUNKS = 19;

/** A text someone wrote in a request, with the format it's written in. */
export interface RequestText {
  /** The text as it was written. */
  text: string;
  /** Its format. */
  format: RequestTextFormat;
}

/** One entry of a request's history, as its readers see it. */
export interface RequestEntryView {
  /** The entry's ID. */
  id: string;
  /**
   * What it is: a reply, a change of the status, title, type or priority, or
   * someone assigned or removed (`assignee`).
   */
  kind: RequestEntryKind;
  /** Who wrote or changed it. */
  author: RequestPerson;
  /** When. */
  createdAt: Date;
  /** A reply's text; `null` for a change. */
  body: RequestText | null;
  /** What a change replaced, or `null`. */
  from: string | null;
  /**
   * What a change set; `null` for a reply. For an `assignee` entry, whether
   * its subject was assigned or removed (`ASSIGNMENT_CHANGES`).
   */
  to: string | null;
  /**
   * Who an `assignee` entry is about, on the staff's side (without a name
   * once their account is gone); `null` for every other kind.
   */
  subject: RequestPerson | null;
  /**
   * Whether an `assignee` entry's subject made it themselves: assigned
   * themselves, or removed themselves. Worked out here, where the IDs are,
   * since readers at the company get none.
   */
  subjectIsAuthor: boolean;
}

/** A request with everything its page shows. */
export interface RequestDetail {
  /** The request's ID. */
  id: string;
  /** Its number. */
  number: number;
  /** The prefix its number is shown with, e.g. "AD". */
  prefix: string;
  /** Its title. */
  title: string;
  /** What was asked. */
  description: RequestText;
  /** Its type. */
  type: RequestType;
  /** Its status. */
  status: RequestStatus;
  /** When it was last reopened, while it's open again; `null` otherwise. */
  reopenedAt: Date | null;
  /** Its priority, or `null` for readers who don't see priorities. */
  priority: RequestPriority | null;
  /** Who raised it. */
  raisedBy: RequestPerson;
  /** The staff members it's assigned to, by name; empty while nobody is. */
  assignees: RequestPerson[];
  /** When it was raised. */
  createdAt: Date;
  /** When the staff first replied to it, or `null` while they haven't. */
  firstResponseAt: Date | null;
  /** When it was raised, replied to or changed last (a change of priority doesn't count). */
  lastActivityAt: Date;
  /** Its company. A deactivated company's requests can only be read. */
  company: { id: string; name: string; slug: string; deactivated: boolean };
  /** What the reader may do in that company. */
  permissions: Set<Permission>;
  /** How to address the reader: as the staff, as someone who takes part, or as a follower. */
  audience: RequestAudience;
  /** The name the staff are shown with, for the staff's label next to their names. */
  staffName: string;
  /** The entries shown: the latest ones, oldest first. */
  entries: RequestEntryView[];
  /** How many earlier entries there are that aren't shown. */
  earlierEntries: number;
}

/**
 * Reads the request an address names: its number, or its number after the
 * staff's current prefix (`AD-142`), for the addresses that redirect to a
 * request's page (`/requests/AD-142`, `/r/142`, `/r/AD-142`). It checks no
 * access: it only turns an address into a number. The redirect goes there
 * whether or not the request exists or the reader may see it, and the
 * request's page decides that, so a redirect reveals nothing.
 *
 * @param ctx - Service context.
 * @param ref - The part of the address that names the request.
 * @returns The request's number, or `null` when the address names none.
 */
export async function findRequestNumber(ctx: ServiceContext, ref: string): Promise<number | null> {
  return parseRequestReference(ref.trim(), await getRequestPrefix(ctx.db));
}

/**
 * Finds a request the actor may see, for its page's title.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param ref - The request's number or ID.
 * @returns Its number and the prefix it's shown with.
 * @throws {ServiceError} `not_found` if it doesn't exist or isn't visible.
 */
export async function findRequest(
  ctx: ServiceContext,
  actor: Actor,
  ref: string,
): Promise<{ number: number; prefix: string }> {
  const [access, prefix] = await Promise.all([
    getRequestAccess(ctx.db, actor, ref),
    getRequestPrefix(ctx.db),
  ]);
  return { number: access.request.number, prefix };
}

/**
 * Loads a request with its conversation: the latest {@link THREAD_CHUNK}
 * entries, and as many earlier chunks as asked for.
 *
 * Readers who don't see priorities get none: not the request's, and not the
 * history's entries about it.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param ref - The request's number or ID.
 * @param options - Options.
 * @param options.earlier - How many earlier chunks to add (at most {@link MAX_EARLIER_CHUNKS}).
 * @returns The request.
 * @throws {ServiceError} `not_found` if it doesn't exist or isn't visible.
 */
export async function getRequest(
  ctx: ServiceContext,
  actor: Actor,
  ref: string,
  options: { earlier?: number } = {},
): Promise<RequestDetail> {
  const { request: found, company, permissions } = await getRequestAccess(ctx.db, actor, ref);
  const internal = permissions.has('requests:view-internal');
  const earlier = Number.isSafeInteger(options.earlier)
    ? Math.min(Math.max(options.earlier ?? 0, 0), MAX_EARLIER_CHUNKS)
    : 0;
  const shown = and(
    eq(requestEntry.requestId, found.id),
    internal ? undefined : ne(requestEntry.kind, 'priority'),
  );

  const [raisedBy, assignees, staffName, prefix, firstResponse, total, latest] = await Promise.all([
    found.createdBy
      ? ctx.db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(eq(user.id, found.createdBy))
      : [],
    ctx.db
      .select({ id: user.id, name: user.name })
      .from(requestAssignee)
      .innerJoin(user, eq(requestAssignee.userId, user.id))
      .where(eq(requestAssignee.requestId, found.id))
      .orderBy(...orderTerms('asc', textOrder(user.name), user.id)),
    getStaffName(ctx.db),
    getRequestPrefix(ctx.db),
    ctx.db
      .select({ at: min(requestEntry.createdAt) })
      .from(requestEntry)
      .where(
        and(
          eq(requestEntry.requestId, found.id),
          eq(requestEntry.kind, 'comment'),
          eq(requestEntry.authorSide, 'staff'),
        ),
      ),
    ctx.db.select({ total: count() }).from(requestEntry).where(shown),
    ctx.db
      .select({
        id: requestEntry.id,
        kind: requestEntry.kind,
        authorSide: requestEntry.authorSide,
        createdAt: requestEntry.createdAt,
        body: requestEntry.body,
        bodyFormat: requestEntry.bodyFormat,
        from: requestEntry.fromValue,
        to: requestEntry.toValue,
        author: { id: user.id, name: user.name },
        subject: { id: subjectUser.id, name: subjectUser.name },
      })
      .from(requestEntry)
      .leftJoin(user, eq(requestEntry.authorId, user.id))
      .leftJoin(subjectUser, eq(requestEntry.subjectUserId, subjectUser.id))
      .where(shown)
      .orderBy(desc(requestEntry.id))
      .limit(THREAD_CHUNK * (earlier + 1)),
  ]);

  const entries = latest
    .reverse()
    .map(({ author, authorSide, body, bodyFormat, subject, ...entry }) => ({
      ...entry,
      author: requestPerson(author ?? { id: null, name: null }, authorSide, actor),
      body: body === null ? null : { text: body, format: bodyFormat },
      // An assignment's subject is always on the staff's side, also once their account is gone.
      subject:
        entry.kind === 'assignee'
          ? requestPerson(subject ?? { id: null, name: null }, 'staff', actor)
          : null,
      subjectIsAuthor:
        entry.kind === 'assignee' && Boolean(subject?.id) && subject?.id === author?.id,
    }));
  return {
    id: found.id,
    number: found.number,
    prefix,
    title: found.title,
    description: { text: found.description, format: found.descriptionFormat },
    type: found.type,
    status: found.status,
    reopenedAt: found.reopenedAt,
    priority: internal ? found.priority : null,
    raisedBy: requestPerson(raisedBy[0] ?? { id: null, name: null }, found.createdBySide, actor),
    assignees: assignees.map((person) => requestPerson(person, 'staff', actor)),
    createdAt: found.createdAt,
    firstResponseAt: firstResponse[0]?.at ?? null,
    lastActivityAt: found.lastActivityAt,
    company: {
      id: company.id,
      name: company.name,
      slug: company.slug,
      deactivated: company.deactivatedAt !== null,
    },
    permissions,
    audience: requestAudienceIn(actor, company),
    staffName,
    entries,
    earlierEntries: firstRow(total, 'the entry count').total - entries.length,
  };
}
