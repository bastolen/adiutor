/**
 * @file A request's conversation as its reader reads it: the entries of its
 * history they're shown (the groups of their saved activity view, never one
 * they aren't offered, and nothing only the staff see unless they're staff),
 * a chunk at a time, newest first, down to an entry a link points at; and
 * each entry as they see it. Part of reading one request (`getRequest` in
 * `detail.ts`); the entries' texts are in `detail-texts.ts`.
 */
import { and, count, desc, eq, gt, gte, inArray, notInArray, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { requestEntry, user } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import {
  type ActivityView,
  activityKinds,
  effectiveActivityGroups,
  mayEditNote,
  mayEditReply,
  type RequestEntryKind,
  STAFF_ONLY_ENTRY_KINDS,
} from '@/lib/requests';
import { idSchema } from '@/lib/validation';

import type { ServiceContext } from '../context';
import { type RequestPerson, requestPerson } from './access';
import {
  type PageReader,
  signedInAsMark,
  type SignedInAsMark,
  signedInAsStaff,
} from './detail-reader';
import { type PageContext, requestText, type RequestText } from './detail-texts';

/** The account an `assignee` entry is about, joined next to its author's. */
const subjectUser = alias(user, 'subject_user');

/** How many entries of a request's history are loaded at a time: the latest ones first. */
export const THREAD_CHUNK = 50;

/** How many earlier chunks a reader can add to the latest one. */
export const MAX_EARLIER_CHUNKS = 19;

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
 * @param options - What the page asks for (see `getRequest`).
 * @param options.earlier - How many earlier chunks to add.
 * @param options.entry - The ID of the entry a link points at.
 * @returns The entries shown, and how.
 */
export async function loadThread(
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
 * An entry of a request's history as its reader sees it: who did it (and,
 * for the readers who may know, whether they did it while signed in as its
 * author), its text, the types a type change names as they're called now,
 * and who an assignment is about.
 *
 * @param page - What the page is built from.
 * @param row - The entry, as {@link loadEntries} loaded it.
 * @returns The entry.
 */
export function entryView(page: PageContext, row: EntryRow): RequestEntryView {
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
