/**
 * @file One request as its readers see it: its details, who it's assigned
 * to, the company it's in (none for an internal request), what the reader may do with it, and its
 * conversation, filtered and ordered the way the reader reads it (their
 * saved activity view), and every file on it the reader may open. Its parts
 * are in the files next to it: who reads the page (`detail-reader.ts`), its
 * texts (`detail-texts.ts`), its files (`detail-files.ts`) and its
 * conversation (`detail-thread.ts`).
 */
import { and, eq, min } from 'drizzle-orm';

import { requestEntry, requestParticipant, user } from '@/db/schema';
import { getGlobalPermissions, type Permission } from '@/lib/authz/permissions';
import {
  type ActivityView,
  mayEditDescription,
  parseRequestReference,
  type RequestAudience,
  type RequestPriority,
  type RequestStatus,
} from '@/lib/requests';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { orderTerms, textOrder } from '../pagination';
import { loadPictures } from '../people/pictures';
import getRequestPrefix from '../people/request-prefix';
import getStaffName from '../people/staff-name';
import {
  getRequestAccess,
  requestAudienceIn,
  type RequestPerson,
  requestPerson,
  type RequestRow,
} from './access';
import { readActivityView } from './activity-view';
import requestFiles, { type RequestFileView } from './detail-files';
import { type PageReader, signedInAsMark, type SignedInAsMark } from './detail-reader';
import {
  loadTextRows,
  type PageContext,
  requestText,
  type RequestText,
  shownTexts,
} from './detail-texts';
import { entryView, loadThread, type RequestEntryView } from './detail-thread';
import { ASSIGNED, loadSubscribers } from './participants';
import { requestTypeNames } from './types';

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
  /**
   * Every file on it the reader may open, wherever its text is (on an
   * earlier reply than the page shows, or in a group the reader hides), in
   * the page's order, without removed files; a note's only for readers with
   * `requests:view-internal`. For the Files card and the viewer.
   */
  files: RequestFileView[];
  /** Its type's key. */
  type: string;
  /** Its type's name. */
  typeName: string;
  /** Its status. */
  status: RequestStatus;
  /** When it was last reopened, while it's open again; `null` otherwise. */
  reopenedAt: Date | null;
  /** Its priority, or `null` for readers who don't see priorities. */
  priority: RequestPriority | null;
  /** Who raised it: for a request raised for someone, that person. */
  raisedBy: RequestPerson;
  /**
   * The staff member who raised it for `raisedBy` (decision 0047), for every
   * reader; left out when `raisedBy` raised it themself.
   */
  raisedOnBehalf?: RequestPerson;
  /**
   * That it was raised while signed in as whoever raised it (`raisedOnBehalf`
   * when it's set, `raisedBy` otherwise), for the readers who may know.
   */
  raisedSignedInAs?: SignedInAsMark;
  /** The staff members it's assigned to, by name; empty while nobody is. */
  assignees: RequestPerson[];
  /**
   * The people subscribed to it that the reader may see, by name, without
   * the ones it's assigned to (they're listed as assignees). The staff see
   * everyone; someone at the company sees the subscribers from their own
   * company, and not which staff members follow along.
   */
  subscribers: RequestPerson[];
  /** Whether the reader is subscribed to it themselves. */
  subscribed: boolean;
  /** When it was raised. */
  createdAt: Date;
  /** When the staff first replied to it, or `null` while they haven't. */
  firstResponseAt: Date | null;
  /** When it was raised, replied to or changed last (a change of priority doesn't count). */
  lastActivityAt: Date;
  /**
   * Its company. A deactivated company's requests can only be read. `null` for an internal
   * request (decision 0048), which only the staff read: its texts keep their links to the
   * staff's pages, as a note does.
   */
  company: { id: string; name: string; slug: string; deactivated: boolean } | null;
  /** What the reader may do in that company. */
  permissions: Set<Permission>;
  /** How to address the reader: as the staff, as someone who takes part, or as a follower. */
  audience: RequestAudience;
  /** The name the staff are shown with, for the staff's label next to their names. */
  staffName: string;
  /**
   * How the reader reads the activity: its order, and the groups shown
   * (`null` for everything), as their saved choice applies to them (never a
   * group they aren't offered).
   */
  activity: ActivityView;
  /** The entries shown: the latest ones of the groups shown, in the reader's order. */
  entries: RequestEntryView[];
  /** How many earlier entries of the groups shown there are that aren't shown. */
  earlierEntries: number;
  /**
   * How many earlier chunks of `THREAD_CHUNK` entries are shown besides
   * the latest one: the ones asked for, or as many as reach the entry a link
   * points at when that's further back. "Show earlier" goes on from there.
   */
  earlierChunks: number;
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
 * Loads the people a request's page names besides its history: who raised
 * it, the staff member who raised it for them (if one did), the staff
 * member signed in as whoever raised it when it was raised (if one was),
 * the staff members it's assigned to and its subscribers who can read it by
 * now (`loadSubscribers`), both by name.
 *
 * @param ctx - Service context.
 * @param found - The request.
 * @returns Their rows; `null` for an account that's gone, or a staff member there wasn't.
 */
async function loadPeople(ctx: ServiceContext, found: RequestRow) {
  const [raisedBy, raisedOnBehalfBy, raisedByStaff, assignees, following] = await Promise.all([
    found.createdBy
      ? ctx.db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(eq(user.id, found.createdBy))
      : [],
    found.createdOnBehalfBy
      ? ctx.db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(eq(user.id, found.createdOnBehalfBy))
      : [],
    found.createdSignedInAsStaffId
      ? ctx.db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, found.createdSignedInAsStaffId))
      : [],
    ctx.db
      .select({ id: user.id, name: user.name })
      .from(requestParticipant)
      .innerJoin(user, eq(requestParticipant.userId, user.id))
      .where(and(eq(requestParticipant.requestId, found.id), ASSIGNED))
      .orderBy(...orderTerms('asc', textOrder(user.name), user.id)),
    loadSubscribers(ctx.db, found),
  ]);
  return {
    raisedBy: raisedBy[0] ?? null,
    raisedOnBehalfBy: raisedOnBehalfBy[0] ?? null,
    raisedByStaff: raisedByStaff[0] ?? null,
    assignees,
    following,
  };
}

/**
 * When the staff first replied to a request.
 *
 * @param ctx - Service context.
 * @param requestId - The request.
 * @returns When, or `null` while they haven't.
 */
async function firstStaffReplyAt(ctx: ServiceContext, requestId: string): Promise<Date | null> {
  const [first] = await ctx.db
    .select({ at: min(requestEntry.createdAt) })
    .from(requestEntry)
    .where(
      and(
        eq(requestEntry.requestId, requestId),
        eq(requestEntry.kind, 'comment'),
        eq(requestEntry.authorSide, 'staff'),
      ),
    );
  return first?.at ?? null;
}

/**
 * Loads a request with its conversation: the latest `THREAD_CHUNK`
 * entries, and as many earlier chunks as asked for, of the groups the reader
 * shows and in their order (their saved activity view, `readActivityView`).
 *
 * Readers who don't see priorities get none: not the request's, and not the
 * history's entries about it. Nor does a saved choice ever show them an
 * internal note: the groups apply on top of what they may see. An entry a
 * link points at (`options.entry`, from an email) is shown whatever groups
 * the reader chose, as long as they may see it, and with everything down to
 * it: the conversation shows as many earlier chunks as reach it, without a
 * gap, and says how many it shows (`earlierChunks`). An entry further back
 * than `MAX_EARLIER_CHUNKS` reach leaves the chunks as asked.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param ref - The request's number or ID.
 * @param options - Options.
 * @param options.earlier - How many earlier chunks to add (at most `MAX_EARLIER_CHUNKS`).
 * @param options.entry - The ID of the entry a link points at, shown whatever groups the reader
 *   chose and with as many earlier chunks as reach it; anything that isn't an ID is left out.
 * @returns The request.
 * @throws {ServiceError} `not_found` if it doesn't exist or isn't visible.
 */
export async function getRequest(
  ctx: ServiceContext,
  actor: Actor,
  ref: string,
  options: { earlier?: number; entry?: string | null } = {},
): Promise<RequestDetail> {
  const [{ request: found, company, permissions }, saved] = await Promise.all([
    getRequestAccess(ctx.db, actor, ref),
    readActivityView(ctx.db, actor.id),
  ]);
  const reader: PageReader = {
    actor,
    permissions,
    globalPermissions: getGlobalPermissions(actor),
    internal: permissions.has('requests:view-internal'),
  };
  const [people, textRows, thread, staffName, prefix, firstResponseAt, typeNames] =
    await Promise.all([
      loadPeople(ctx, found),
      loadTextRows(ctx, found.id, reader.internal),
      loadThread(ctx, found.id, reader, saved, options),
      getStaffName(ctx.db),
      getRequestPrefix(ctx.db),
      firstStaffReplyAt(ctx, found.id),
      requestTypeNames(ctx.db),
    ]);

  // The subscribers the reader may see: the company's own for someone at the company, and
  // never someone the request is assigned to, who is listed as that.
  const assigned = new Set(people.assignees.map(({ id }) => id));
  const subscribers = people.following.filter(
    ({ id, member }) => !assigned.has(id) && (reader.internal || member),
  );
  // Everyone the page names, with their pictures, in one go.
  const pictures = await loadPictures(ctx.db, [
    found.createdBy,
    found.createdOnBehalfBy,
    ...people.assignees.map(({ id }) => id),
    ...subscribers.map(({ id }) => id),
    ...thread.latest.flatMap(({ author, subject }) => [author?.id ?? null, subject?.id ?? null]),
  ]);
  const page: PageContext = {
    reader,
    found,
    company,
    staffName,
    texts: shownTexts(reader, company, textRows),
    pictures,
    typeNames,
  };
  // Loaded newest first; turned around for a reader who reads the oldest first.
  const entries = (
    thread.activity.order === 'oldest' ? thread.latest.reverse() : thread.latest
  ).map((row) => entryView(page, row));
  // A staff member signed in as someone did the work of whoever raised it: for a request raised
  // for someone, the staff member who raised it for them.
  const raisedSignedInAs = signedInAsMark(
    reader,
    { signedInAs: found.createdSignedInAs, staff: people.raisedByStaff },
    found.createdOnBehalf ? found.createdOnBehalfBy : found.createdBy,
  );
  return {
    id: found.id,
    number: found.number,
    prefix,
    title: found.title,
    description: requestText(page, {
      entryId: null,
      text: found.description,
      format: found.descriptionFormat,
      editedAt: found.descriptionEditedAt,
      mayEdit: mayEditDescription(permissions, found.status),
      staffOnly: false,
    }),
    files: requestFiles(reader, textRows.attached, thread.activity.order),
    type: found.type,
    typeName: typeNames.get(found.type) ?? found.type,
    status: found.status,
    reopenedAt: found.reopenedAt,
    priority: reader.internal ? found.priority : null,
    raisedBy: requestPerson(
      people.raisedBy ?? { id: null, name: null },
      found.createdBySide,
      actor,
      pictures,
    ),
    ...(found.createdOnBehalf && {
      raisedOnBehalf: requestPerson(
        people.raisedOnBehalfBy ?? { id: null, name: null },
        'staff',
        actor,
        pictures,
      ),
    }),
    ...(raisedSignedInAs && { raisedSignedInAs }),
    assignees: people.assignees.map((person) => requestPerson(person, 'staff', actor, pictures)),
    // Someone on the staff who is also in the company is a colleague to the company's readers.
    subscribers: subscribers.map(({ id, name, staff }) =>
      requestPerson({ id, name }, reader.internal && staff ? 'staff' : 'company', actor, pictures),
    ),
    subscribed: people.following.some(({ id }) => id === actor.id),
    createdAt: found.createdAt,
    firstResponseAt,
    lastActivityAt: found.lastActivityAt,
    company: company && {
      id: company.id,
      name: company.name,
      slug: company.slug,
      deactivated: company.deactivatedAt !== null,
    },
    permissions,
    audience: requestAudienceIn(actor, company),
    staffName,
    activity: thread.activity,
    entries,
    earlierEntries: thread.total - entries.length,
    earlierChunks: thread.earlierChunks,
  };
}
