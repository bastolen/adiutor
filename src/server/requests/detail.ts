/**
 * @file One request as its readers see it: its details, who it's assigned
 * to, the company it's in, what the reader may do with it, and its
 * conversation, filtered and ordered the way the reader reads it (their
 * saved activity view).
 */
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  min,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  requestEntry,
  requestMention,
  requestParticipant,
  requestTextVersion,
  user,
} from '@/db/schema';
import { maySeeSignedInAsWork } from '@/lib/authz/impersonation';
import { getGlobalPermissions, type Permission } from '@/lib/authz/permissions';
import { firstRow } from '@/lib/defined';
import { visibleName } from '@/lib/display-name';
import { appUrl } from '@/lib/env';
import {
  type ActivityView,
  activityKinds,
  effectiveActivityGroups,
  mayContribute,
  mayEditDescription,
  mayEditNote,
  mayEditReply,
  parseRequestReference,
  type RequestAudience,
  type RequestEntryKind,
  type RequestPriority,
  type RequestStatus,
  type RequestTextFormat,
  STAFF_ONLY_ENTRY_KINDS,
} from '@/lib/requests';
import { idSchema } from '@/lib/validation';

import type { Company } from '../access';
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
import { editableText, type TextMention } from './edits';
import mentionKey from './mention-key';
import { ASSIGNED, loadSubscribers } from './participants';
import { withoutStaffPageLinksToEdit } from './staff-links';
import { requestTypeNames } from './types';

/** The account an `assignee` entry is about, joined next to its author's. */
const subjectUser = alias(user, 'subject_user');

/** The staff member who did a piece of work while signed in as its author, joined for their name. */
const signedInAsStaff = alias(user, 'signed_in_as_staff');

/**
 * That a staff member did a piece of request work while signed in as the
 * person it shows as theirs (decision 0028). Only the readers who may know
 * get it (`maySeeSignedInAsWork`): that person, and the staff who see the
 * audit log.
 */
export interface SignedInAsMark {
  /** The staff member's name, or `null` once their account is gone (or has no visible name). */
  staffName: string | null;
}

/** How many entries of a request's history are loaded at a time: the latest ones first. */
export const THREAD_CHUNK = 50;

/** How many earlier chunks a reader can add to the latest one. */
export const MAX_EARLIER_CHUNKS = 19;

/** Someone a text mentions, as its reader sees them. */
export interface MentionedPerson extends RequestPerson {
  /**
   * Their key in the request's company (`mentionKey`), the one a text that's
   * being written names them with, for a reader who may write in the request
   * (`requests:contribute`, the readers the list at "@" is for): a mention
   * they copy into a text stays one. `null` for every other reader, and for
   * someone without an account or a name to show. On its own a key says
   * nothing about who someone is; who a writer may mention is checked when
   * the text is sent.
   */
  key: string | null;
}

/** A text someone wrote in a request, with the format it's written in. */
export interface RequestText {
  /** The text as it was written. */
  text: string;
  /** Its format. */
  format: RequestTextFormat;
  /**
   * The people the text mentions, by the ID their marker in the text names
   * (`storedMentionId`). Only the text's own: a marker with another text's
   * ID names nobody. Left out for a text that mentions nobody.
   */
  mentions?: Record<string, MentionedPerson>;
  /** When it was last edited; `null` or left out while it's as it was written. */
  editedAt?: Date | null;
  /**
   * That its last edit was made while signed in as its editor, and who that
   * editor is, for the readers who may know: the editor, and the staff who
   * see the audit log.
   */
  editedSignedInAs?: SignedInAsMark & { editedBy: RequestPerson };
  /**
   * For a reader who may edit it now (`mayEditDescription`, `mayEditReply`):
   * the text as its editor starts from it, with its mentions as ones that
   * are being written, and how many times it was edited, which the edit
   * sends back so an edit someone made meanwhile isn't overwritten. A reader
   * who may not open the staff's pages (without `users:view`: everyone at a
   * company) gets a description or reply without links to them
   * (`withoutStaffPageLinksToEdit`), as the page shows it, so a link saved
   * before they were kept out of texts never reaches their browser; an
   * internal note keeps them.
   */
  edit?: { markdown: string; edits: number };
  /** Its earlier versions, newest first, for the staff (`requests:view-internal`) only. */
  versions?: TextVersion[];
}

/** An earlier version of a request's text, as the staff read it. */
export interface TextVersion {
  /** The text as it was before the edit, its mentions as plain names. */
  text: string;
  /** Its format. */
  format: RequestTextFormat;
  /** Who edited it away. */
  editedBy: RequestPerson;
  /** That the edit was made while signed in as `editedBy`, for the readers who may know. */
  signedInAs?: SignedInAsMark;
  /** When. */
  at: Date;
}

/** One entry of a request's history, as its readers see it. */
export interface RequestEntryView {
  /** The entry's ID. */
  id: string;
  /**
   * What it is: a reply, an internal note (only ever for the staff), a change
   * of the status, title, type or priority, or someone assigned or removed
   * (`assignee`).
   */
  kind: RequestEntryKind;
  /** Who wrote or changed it. */
  author: RequestPerson;
  /** That it was done while signed in as `author`, for the readers who may know. */
  signedInAs?: SignedInAsMark;
  /** When. */
  createdAt: Date;
  /** A reply's or a note's text; `null` for a change. */
  body: RequestText | null;
  /** What a change replaced, or `null`. For a `type` entry, the type's name. */
  from: string | null;
  /**
   * What a change set; `null` for a reply. For a `type` entry, the type's
   * name; for an `assignee` entry, whether its subject was assigned or
   * removed (`ASSIGNMENT_CHANGES`).
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
  /** Its company. A deactivated company's requests can only be read. */
  company: { id: string; name: string; slug: string; deactivated: boolean };
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
   * How many earlier chunks of {@link THREAD_CHUNK} entries are shown besides
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
 * How many earlier chunks of a conversation it takes to reach the entry a
 * link points at: its place among the entries the reader is shown, newest
 * first, in chunks of {@link THREAD_CHUNK}. Only an entry the reader is
 * shown counts, by the same condition as the entries themselves: for any
 * other ID (another request's entry, or an internal note for someone at the
 * company) it takes none.
 *
 * @param ctx - Service context.
 * @param shown - The condition for the entries the reader is shown, the linked one among them.
 * @param entryId - The linked entry's ID.
 * @returns How many earlier chunks it takes besides the latest one, not yet capped.
 */
async function chunksDownTo(
  ctx: ServiceContext,
  shown: SQL | undefined,
  entryId: string,
): Promise<number> {
  const counted = firstRow(
    await ctx.db
      .select({
        linked: count(sql`case when ${eq(requestEntry.id, entryId)} then 1 end`),
        newer: count(sql`case when ${gt(requestEntry.id, entryId)} then 1 end`),
      })
      .from(requestEntry)
      .where(and(shown, gte(requestEntry.id, entryId))),
    'the count of the entries down to the linked one',
  );
  return counted.linked > 0 ? Math.floor(counted.newer / THREAD_CHUNK) : 0;
}

/** Who reads a request's page, and what that lets them see there. */
interface PageReader {
  /** The reader. */
  actor: Actor;
  /** Their permissions in the request's company. */
  permissions: Set<Permission>;
  /** Their permissions outside a company: whether they open users' pages, see the audit log. */
  globalPermissions: Set<Permission>;
  /** Whether they see what only the staff see (`requests:view-internal`). */
  internal: boolean;
}

/**
 * The mark of a piece of work done while signed in as its author, for a
 * reader who may know (`maySeeSignedInAsWork`); nothing for anyone else.
 *
 * @param reader - Who reads it.
 * @param work - The work's row: whether it was done that way, and the staff member's name.
 * @param work.signedInAs - Whether a staff member did it while signed in as its author.
 * @param work.staff - The staff member, while their account exists.
 * @param authorId - Who it shows as theirs, while their account exists.
 * @returns The mark to spread into what the reader gets.
 */
function signedInAsMark(
  reader: PageReader,
  work: { signedInAs: boolean; staff: { name: string | null } | null },
  authorId: string | null | undefined,
): SignedInAsMark | undefined {
  return work.signedInAs &&
    maySeeSignedInAsWork({
      isAuthor: Boolean(authorId) && authorId === reader.actor.id,
      globalPermissions: reader.globalPermissions,
    })
    ? { staffName: visibleName(work.staff?.name) }
    : undefined;
}

/**
 * Loads entries of a request's history, newest first, with who wrote or
 * changed each, who an `assignee` entry is about, and the staff member
 * signed in as the author, if one was.
 *
 * @param ctx - Service context.
 * @param shown - The condition for the entries the reader is shown.
 * @param limit - How many to load.
 * @returns The entries' rows.
 */
function loadEntries(ctx: ServiceContext, shown: SQL | undefined, limit: number) {
  return ctx.db
    .select({
      id: requestEntry.id,
      kind: requestEntry.kind,
      authorSide: requestEntry.authorSide,
      createdAt: requestEntry.createdAt,
      body: requestEntry.body,
      bodyFormat: requestEntry.bodyFormat,
      editedAt: requestEntry.editedAt,
      from: requestEntry.fromValue,
      to: requestEntry.toValue,
      author: { id: user.id, name: user.name },
      subject: { id: subjectUser.id, name: subjectUser.name },
      signedInAs: requestEntry.signedInAs,
      signedInAsStaff: { name: signedInAsStaff.name },
    })
    .from(requestEntry)
    .leftJoin(user, eq(requestEntry.authorId, user.id))
    .leftJoin(subjectUser, eq(requestEntry.subjectUserId, subjectUser.id))
    .leftJoin(signedInAsStaff, eq(requestEntry.signedInAsStaffId, signedInAsStaff.id))
    .where(shown)
    .orderBy(desc(requestEntry.id))
    .limit(limit);
}

/** An entry of a request's history, as {@link loadEntries} loads it. */
type EntryRow = Awaited<ReturnType<typeof loadEntries>>[number];

/** The part of a request's history its reader is shown. */
interface ShownThread {
  /** How the reader reads it, as their saved choice applies to them. */
  activity: ActivityView;
  /** The entries loaded: the latest of the groups shown, newest first. */
  latest: EntryRow[];
  /** How many entries of the groups shown there are in all. */
  total: number;
  /** How many earlier chunks are loaded besides the latest one. */
  earlierChunks: number;
}

/**
 * Loads the part of a request's history the reader is shown: the latest
 * {@link THREAD_CHUNK} entries of the groups they show (their saved activity
 * view, never a group they aren't offered), as many earlier chunks as asked
 * for or as reach the entry a link points at, and how many entries of those
 * groups there are in all.
 *
 * @param ctx - Service context.
 * @param requestId - The request.
 * @param reader - Who reads it.
 * @param saved - Their saved activity view (`readActivityView`).
 * @param options - What the page asks for (see {@link getRequest}).
 * @param options.earlier - How many earlier chunks to add.
 * @param options.entry - The ID of the entry a link points at.
 * @returns The entries shown, and how.
 */
async function loadThread(
  ctx: ServiceContext,
  requestId: string,
  reader: PageReader,
  saved: ActivityView,
  options: { earlier?: number; entry?: string | null },
): Promise<ShownThread> {
  const { permissions, internal } = reader;
  const earlier = Number.isSafeInteger(options.earlier)
    ? Math.min(Math.max(options.earlier ?? 0, 0), MAX_EARLIER_CHUNKS)
    : 0;
  // The reader's choice, as it applies to them: never a group they aren't offered.
  const activity: ActivityView = {
    order: saved.order,
    groups: effectiveActivityGroups(saved.groups, permissions),
  };
  const kinds = activityKinds(activity.groups, permissions);
  const linked = idSchema.safeParse(options.entry);
  // What only the staff see (a change of priority, an internal note) is left out for everyone
  // else: of the entries, of the count of earlier ones, and of the texts' mentions and versions
  // (`ofShownText`). The reader's groups narrow the entries and the count further, never widen
  // them; the entry a link points at stays, within what the reader may see.
  const ofGroups = kinds ? inArray(requestEntry.kind, kinds) : undefined;
  const shown = and(
    eq(requestEntry.requestId, requestId),
    internal ? undefined : notInArray(requestEntry.kind, [...STAFF_ONLY_ENTRY_KINDS]),
    ofGroups && linked.success ? or(ofGroups, eq(requestEntry.id, linked.data)) : ofGroups,
  );
  // The earlier chunks shown: the ones asked for, or as many as reach the entry a link points at
  // when it's further back, so the conversation shows it without a gap. An entry further back than
  // every chunk a reader can add leaves them as asked: loading them all wouldn't reach it either.
  // Counted with the rest, and only then are the entries loaded.
  const shownEarlier = linked.success
    ? chunksDownTo(ctx, shown, linked.data).then((needed) =>
        needed <= MAX_EARLIER_CHUNKS ? Math.max(earlier, needed) : earlier,
      )
    : Promise.resolve(earlier);
  const [counted, earlierChunks, latest] = await Promise.all([
    ctx.db.select({ total: count() }).from(requestEntry).where(shown),
    shownEarlier,
    shownEarlier.then((chunks) => loadEntries(ctx, shown, THREAD_CHUNK * (chunks + 1))),
  ]);
  return { activity, latest, total: firstRow(counted, 'the entry count').total, earlierChunks };
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
 * Leaves out the rows of a text the reader isn't shown: the description is
 * shown to every reader, an entry's text only when its entry is. The query
 * joins the row's entry for it.
 *
 * @param internal - Whether the reader sees what only the staff see, every text among it.
 * @param entryId - The column with the row's entry; `null` for the description.
 * @returns The condition, or nothing for the staff, who are shown every text.
 */
function ofShownText(
  internal: boolean,
  entryId: typeof requestMention.entryId | typeof requestTextVersion.entryId,
): SQL | undefined {
  return internal
    ? undefined
    : or(isNull(entryId), notInArray(requestEntry.kind, [...STAFF_ONLY_ENTRY_KINDS]));
}

/**
 * Loads what the texts the reader is shown come with ({@link ofShownText}):
 * the people each mentions, and each one's earlier versions, newest first.
 * Every reader gets the versions' rows, since the newest says who made the
 * last edit and how and their number is what an edit sends back; only the
 * staff get the versions themselves ({@link requestText}).
 *
 * @param ctx - Service context.
 * @param requestId - The request.
 * @param internal - Whether the reader sees what only the staff see.
 * @returns The mentions' and the versions' rows.
 */
async function loadTextRows(ctx: ServiceContext, requestId: string, internal: boolean) {
  const [mentioned, versions] = await Promise.all([
    ctx.db
      .select({
        id: requestMention.id,
        entryId: requestMention.entryId,
        side: requestMention.side,
        person: { id: user.id, name: user.name },
      })
      .from(requestMention)
      .leftJoin(user, eq(requestMention.userId, user.id))
      .leftJoin(requestEntry, eq(requestMention.entryId, requestEntry.id))
      .where(
        and(eq(requestMention.requestId, requestId), ofShownText(internal, requestMention.entryId)),
      ),
    ctx.db
      .select({
        entryId: requestTextVersion.entryId,
        text: requestTextVersion.body,
        format: requestTextVersion.bodyFormat,
        editedBySide: requestTextVersion.editedBySide,
        at: requestTextVersion.createdAt,
        editedBy: { id: user.id, name: user.name },
        signedInAs: requestTextVersion.signedInAs,
        signedInAsStaff: { name: signedInAsStaff.name },
      })
      .from(requestTextVersion)
      .leftJoin(user, eq(requestTextVersion.editedBy, user.id))
      .leftJoin(signedInAsStaff, eq(requestTextVersion.signedInAsStaffId, signedInAsStaff.id))
      .leftJoin(requestEntry, eq(requestTextVersion.entryId, requestEntry.id))
      .where(
        and(
          eq(requestTextVersion.requestId, requestId),
          ofShownText(internal, requestTextVersion.entryId),
        ),
      )
      .orderBy(desc(requestTextVersion.id)),
  ]);
  return { mentioned, versions };
}

/**
 * A request's texts as their reader gets them, each under the ID of the
 * reply or note it is (`null` for the description).
 */
interface ShownTexts {
  /** The people each text mentions, as the reader sees them. */
  mentions: Map<string | null, Record<string, MentionedPerson>>;
  /** Each text's mentions as stored, which the text its editor starts from names again. */
  storedMentions: Map<string | null, TextMention[]>;
  /** Each text's earlier versions, newest first. */
  versions: Map<string | null, TextVersion[]>;
}

/**
 * Sorts the mentions and versions of a request's texts by text, as the
 * reader gets them. A mention shows a name, never a picture. A reader who
 * may write here gets each person's key too, so a mention they copy into a
 * text stays one (nothing is written for a deactivated company); someone
 * without an account or a name to show can't be mentioned, so has none.
 *
 * @param reader - Who reads them.
 * @param company - The request's company.
 * @param rows - The texts' mentions and versions ({@link loadTextRows}).
 * @returns The texts' mentions and versions, by text.
 */
function shownTexts(
  reader: PageReader,
  company: Company,
  rows: Awaited<ReturnType<typeof loadTextRows>>,
): ShownTexts {
  const writes = mayContribute(reader.permissions, {
    deactivated: company.deactivatedAt !== null,
  });
  const texts: ShownTexts = { mentions: new Map(), storedMentions: new Map(), versions: new Map() };
  rows.mentioned.forEach(({ entryId, ...mention }) => {
    const { id, side, person } = mention;
    const ofText = texts.mentions.get(entryId) ?? {};
    const asShown = requestPerson(person ?? { id: null, name: null }, side, reader.actor);
    ofText[id] = {
      ...asShown,
      key: writes && person?.id && asShown.name !== null ? mentionKey(company.id, person.id) : null,
    };
    texts.mentions.set(entryId, ofText);
    texts.storedMentions.set(entryId, [...(texts.storedMentions.get(entryId) ?? []), mention]);
  });
  rows.versions.forEach(
    ({ entryId, editedBy, editedBySide, signedInAs, signedInAsStaff: staff, ...version }) => {
      const ofText = texts.versions.get(entryId) ?? [];
      const mark = signedInAsMark(reader, { signedInAs, staff }, editedBy?.id);
      ofText.push({
        ...version,
        editedBy: requestPerson(editedBy ?? { id: null, name: null }, editedBySide, reader.actor),
        ...(mark && { signedInAs: mark }),
      });
      texts.versions.set(entryId, ofText);
    },
  );
  return texts;
}

/** What the parts of a request's page are built from, once everything is loaded. */
interface PageContext {
  /** Who reads it. */
  reader: PageReader;
  /** The request. */
  found: RequestRow;
  /** Its company. */
  company: Company;
  /** The name the staff are shown with. */
  staffName: string;
  /** Its texts' mentions and versions ({@link shownTexts}). */
  texts: ShownTexts;
  /** The pictures of the people the page names (`loadPictures`), by user ID. */
  pictures: ReadonlyMap<string, string | null>;
  /** The request types' names, by key. */
  typeNames: Map<string, string>;
}

/**
 * A text of a request as its reader gets it: the people it mentions, when
 * it was edited (and, for the readers who may know, whether that edit was
 * made while signed in as its editor), what its editor starts from (for a
 * reader who may edit it, without links to the staff's pages unless they
 * may open them or it's an internal note), and its versions (staff).
 *
 * @param page - What the page is built from.
 * @param stored - The text.
 * @param stored.entryId - The reply or note it is; `null` for the description.
 * @param stored.text - The text as it's stored.
 * @param stored.format - Its format.
 * @param stored.editedAt - When it was last edited.
 * @param stored.mayEdit - Whether the reader may edit it now.
 * @param stored.staffOnly - Whether it's an internal note, which keeps its links to the staff's
 *   pages.
 * @returns The text.
 */
function requestText(
  page: PageContext,
  stored: {
    entryId: string | null;
    text: string;
    format: RequestTextFormat;
    editedAt: Date | null;
    mayEdit: boolean;
    staffOnly: boolean;
  },
): RequestText {
  const { reader, texts, company } = page;
  const versions = texts.versions.get(stored.entryId) ?? [];
  // The newest version is the last edit's.
  const lastEdit = versions[0];
  // Nothing of a deactivated company's request changes, so nothing of it is edited.
  const editable = company.deactivatedAt === null;
  // Only a reader who may open the staff's pages gets a text to edit with links to them (and a
  // note keeps them for whoever edits it).
  const keepsStaffLinks = reader.globalPermissions.has('users:view') || stored.staffOnly;
  return {
    text: stored.text,
    format: stored.format,
    mentions: texts.mentions.get(stored.entryId),
    editedAt: stored.editedAt,
    ...(lastEdit?.signedInAs && {
      editedSignedInAs: { ...lastEdit.signedInAs, editedBy: lastEdit.editedBy },
    }),
    ...(editable &&
      stored.mayEdit && {
        edit: {
          markdown: editableText(
            keepsStaffLinks ? stored.text : withoutStaffPageLinksToEdit(stored.text, appUrl),
            texts.storedMentions.get(stored.entryId) ?? [],
            company.id,
            { company: company.name, staff: page.staffName },
          ),
          edits: versions.length,
        },
      }),
    ...(reader.internal && versions.length > 0 && { versions }),
  };
}

/**
 * An entry of a request's history as its reader sees it: who did it (and,
 * for the readers who may know, whether they did it while signed in as its
 * author), its text, the types a type change names as they're called now,
 * and who an assignment is about.
 *
 * @param page - What the page is built from.
 * @param row - The entry, as {@link loadEntries} loaded it.
 * @returns The entry.
 */
function entryView(page: PageContext, row: EntryRow): RequestEntryView {
  const { reader, pictures, typeNames } = page;
  const {
    author,
    authorSide,
    body,
    bodyFormat,
    subject,
    editedAt,
    signedInAs,
    signedInAsStaff: staff,
    ...entry
  } = row;
  const mark = signedInAsMark(reader, { signedInAs, staff }, author?.id);
  const staffOnly = entry.kind === 'note';
  return {
    ...entry,
    ...(mark && { signedInAs: mark }),
    // A type change names the types as they're called now: a type is never deleted.
    ...(entry.kind === 'type' && {
      from: entry.from && (typeNames.get(entry.from) ?? entry.from),
      to: entry.to && (typeNames.get(entry.to) ?? entry.to),
    }),
    author: requestPerson(author ?? { id: null, name: null }, authorSide, reader.actor, pictures),
    body:
      body === null
        ? null
        : requestText(page, {
            entryId: entry.id,
            text: body,
            format: bodyFormat,
            editedAt,
            mayEdit: (staffOnly ? mayEditNote : mayEditReply)(
              reader.permissions,
              page.found.status,
              author?.id === reader.actor.id,
            ),
            staffOnly,
          }),
    // An assignment's subject is always on the staff's side, also once their account is gone.
    subject:
      entry.kind === 'assignee'
        ? requestPerson(subject ?? { id: null, name: null }, 'staff', reader.actor, pictures)
        : null,
    subjectIsAuthor:
      entry.kind === 'assignee' && Boolean(subject?.id) && subject?.id === author?.id,
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
 * Loads a request with its conversation: the latest {@link THREAD_CHUNK}
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
 * than {@link MAX_EARLIER_CHUNKS} reach leaves the chunks as asked.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param ref - The request's number or ID.
 * @param options - Options.
 * @param options.earlier - How many earlier chunks to add (at most {@link MAX_EARLIER_CHUNKS}).
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
    company: {
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
