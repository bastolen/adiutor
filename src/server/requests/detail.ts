/**
 * @file One request as its readers see it: its details, who it's assigned
 * to, the company it's in, what the reader may do with it, and its
 * conversation, filtered and ordered the way the reader reads it (their
 * saved activity view).
 */
import { and, count, desc, eq, inArray, isNull, min, notInArray, or } from 'drizzle-orm';
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
import {
  type ActivityView,
  activityKinds,
  effectiveActivityGroups,
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

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { orderTerms, textOrder } from '../pagination';
import { loadPictures } from '../people/pictures';
import getRequestPrefix from '../people/request-prefix';
import getStaffName from '../people/staff-name';
import { getRequestAccess, requestAudienceIn, type RequestPerson, requestPerson } from './access';
import { readActivityView } from './activity-view';
import { editableText, type TextMention } from './edits';
import mentionKey from './mention-key';
import { loadSubscribers } from './participants';
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
   * sends back so an edit someone made meanwhile isn't overwritten.
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
  /** Who raised it. */
  raisedBy: RequestPerson;
  /** That it was raised while signed in as `raisedBy`, for the readers who may know. */
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
 * entries, and as many earlier chunks as asked for, of the groups the reader
 * shows and in their order (their saved activity view, `readActivityView`).
 *
 * Readers who don't see priorities get none: not the request's, and not the
 * history's entries about it. Nor does a saved choice ever show them an
 * internal note: the groups apply on top of what they may see. An entry a
 * link points at (`options.entry`, from an email) is shown whatever groups
 * the reader chose, as long as they may see it.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param ref - The request's number or ID.
 * @param options - Options.
 * @param options.earlier - How many earlier chunks to add (at most {@link MAX_EARLIER_CHUNKS}).
 * @param options.entry - The ID of the entry a link points at, shown whatever groups the reader
 *   chose; anything that isn't an ID is left out.
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
  const internal = permissions.has('requests:view-internal');
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
  // else: of the entries, of the count of earlier ones, and of the texts' mentions and versions.
  // The reader's groups narrow the entries and the count further, never widen them; the entry a
  // link points at stays, within what the reader may see.
  const ofGroups = kinds ? inArray(requestEntry.kind, kinds) : undefined;
  const shown = and(
    eq(requestEntry.requestId, found.id),
    internal ? undefined : notInArray(requestEntry.kind, [...STAFF_ONLY_ENTRY_KINDS]),
    ofGroups && linked.success ? or(ofGroups, eq(requestEntry.id, linked.data)) : ofGroups,
  );
  /**
   * Leaves out the rows of a text the reader isn't shown: the description is
   * shown to every reader, an entry's text only when its entry is.
   *
   * @param entryId - The column with the row's entry; `null` for the description.
   * @returns The condition, or nothing for the staff, who are shown every text.
   */
  const ofShownText = (
    entryId: typeof requestMention.entryId | typeof requestTextVersion.entryId,
  ) =>
    internal
      ? undefined
      : or(isNull(entryId), notInArray(requestEntry.kind, [...STAFF_ONLY_ENTRY_KINDS]));
  const globalPermissions = getGlobalPermissions(actor);
  /**
   * The mark of a piece of work done while signed in as its author, for a
   * reader who may know (`maySeeSignedInAsWork`); nothing for anyone else.
   *
   * @param work - The work's row: whether it was done that way, and the staff member's name.
   * @param work.signedInAs - Whether a staff member did it while signed in as its author.
   * @param work.staff - The staff member, while their account exists.
   * @param authorId - Who it shows as theirs, while their account exists.
   * @returns The mark to spread into what the reader gets.
   */
  const signedInAsOf = (
    work: { signedInAs: boolean; staff: { name: string | null } | null },
    authorId: string | null | undefined,
  ): SignedInAsMark | undefined =>
    work.signedInAs &&
    maySeeSignedInAsWork({
      isAuthor: Boolean(authorId) && authorId === actor.id,
      globalPermissions,
    })
      ? { staffName: visibleName(work.staff?.name) }
      : undefined;

  const [
    raisedBy,
    raisedByStaff,
    assignees,
    following,
    mentioned,
    versions,
    staffName,
    prefix,
    firstResponse,
    total,
    latest,
    typeNames,
  ] = await Promise.all([
    found.createdBy
      ? ctx.db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(eq(user.id, found.createdBy))
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
      .where(
        and(eq(requestParticipant.requestId, found.id), eq(requestParticipant.role, 'assignee')),
      )
      .orderBy(...orderTerms('asc', textOrder(user.name), user.id)),
    loadSubscribers(ctx.db, found),
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
      .where(and(eq(requestMention.requestId, found.id), ofShownText(requestMention.entryId))),
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
        and(eq(requestTextVersion.requestId, found.id), ofShownText(requestTextVersion.entryId)),
      )
      .orderBy(desc(requestTextVersion.id)),
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
      .limit(THREAD_CHUNK * (earlier + 1)),
    requestTypeNames(ctx.db),
  ]);

  // Each text's own mentions: the description's under no entry, a reply's under its entry. A
  // mention shows a name, never a picture. A reader who may write here gets each person's key
  // too, so a mention they copy into a text stays one (nothing is written for a deactivated
  // company); someone without an account or a name to show can't be mentioned, so has none.
  const writes = permissions.has('requests:contribute') && company.deactivatedAt === null;
  const mentionsOf = new Map<string | null, Record<string, MentionedPerson>>();
  mentioned.forEach(({ id, entryId, side, person }) => {
    const ofText = mentionsOf.get(entryId) ?? {};
    const asShown = requestPerson(person ?? { id: null, name: null }, side, actor);
    ofText[id] = {
      ...asShown,
      key: writes && person?.id && asShown.name !== null ? mentionKey(company.id, person.id) : null,
    };
    mentionsOf.set(entryId, ofText);
  });

  // What each text was before its edits: everyone gets how many there were (to edit it), only the
  // staff get the versions themselves.
  const versionsOf = new Map<string | null, TextVersion[]>();
  versions.forEach(
    ({ entryId, editedBy, editedBySide, signedInAs, signedInAsStaff: staff, ...version }) => {
      const ofText = versionsOf.get(entryId) ?? [];
      const mark = signedInAsOf({ signedInAs, staff }, editedBy?.id);
      ofText.push({
        ...version,
        editedBy: requestPerson(editedBy ?? { id: null, name: null }, editedBySide, actor),
        ...(mark && { signedInAs: mark }),
      });
      versionsOf.set(entryId, ofText);
    },
  );
  const textMentions = new Map<string | null, TextMention[]>();
  mentioned.forEach(({ entryId, ...mention }) => {
    textMentions.set(entryId, [...(textMentions.get(entryId) ?? []), mention]);
  });
  const names = { company: company.name, staff: staffName };
  // Nothing of a deactivated company's request changes, so nothing of it is edited.
  const editable = company.deactivatedAt === null;
  /**
   * What a text adds for its readers: when it was edited (and, for the
   * readers who may know, whether that edit was made while signed in as its
   * editor), what its editor starts from (for a reader who may edit it), and
   * its versions (staff).
   *
   * @param entryId - The reply; `null` for the description.
   * @param stored - The text as it's stored.
   * @param editedAt - When it was last edited.
   * @param mayEdit - Whether the reader may edit it now.
   * @returns The text's extra fields.
   */
  const editsOf = (
    entryId: string | null,
    stored: string,
    editedAt: Date | null,
    mayEdit: boolean,
  ): Pick<RequestText, 'editedAt' | 'editedSignedInAs' | 'edit' | 'versions'> => {
    const ofText = versionsOf.get(entryId) ?? [];
    // The newest version is the last edit's.
    const lastEdit = ofText[0];
    return {
      editedAt,
      ...(lastEdit?.signedInAs && {
        editedSignedInAs: { ...lastEdit.signedInAs, editedBy: lastEdit.editedBy },
      }),
      ...(editable &&
        mayEdit && {
          edit: {
            markdown: editableText(stored, textMentions.get(entryId) ?? [], company.id, names),
            edits: ofText.length,
          },
        }),
      ...(internal && ofText.length > 0 && { versions: ofText }),
    };
  };

  // Everyone the page names, with their pictures, in one go.
  // The subscribers the reader may see: the company's own for someone at the company, and
  // never someone the request is assigned to, who is listed as that.
  const assigned = new Set(assignees.map(({ id }) => id));
  const subscribers = following.filter(
    ({ id, member }) => !assigned.has(id) && (internal || member),
  );

  const pictures = await loadPictures(ctx.db, [
    found.createdBy,
    ...assignees.map(({ id }) => id),
    ...subscribers.map(({ id }) => id),
    ...latest.flatMap(({ author, subject }) => [author?.id ?? null, subject?.id ?? null]),
  ]);
  // Loaded newest first; turned around for a reader who reads the oldest first.
  const entries = (activity.order === 'oldest' ? latest.reverse() : latest).map(
    ({
      author,
      authorSide,
      body,
      bodyFormat,
      subject,
      editedAt,
      signedInAs,
      signedInAsStaff: staff,
      ...entry
    }) => {
      const mark = signedInAsOf({ signedInAs, staff }, author?.id);
      return {
        ...entry,
        ...(mark && { signedInAs: mark }),
        // A type change names the types as they're called now: a type is never deleted.
        ...(entry.kind === 'type' && {
          from: entry.from && (typeNames.get(entry.from) ?? entry.from),
          to: entry.to && (typeNames.get(entry.to) ?? entry.to),
        }),
        author: requestPerson(author ?? { id: null, name: null }, authorSide, actor, pictures),
        body:
          body === null
            ? null
            : {
                text: body,
                format: bodyFormat,
                mentions: mentionsOf.get(entry.id),
                ...editsOf(
                  entry.id,
                  body,
                  editedAt,
                  (entry.kind === 'note' ? mayEditNote : mayEditReply)(
                    permissions,
                    found.status,
                    author?.id === actor.id,
                  ),
                ),
              },
        // An assignment's subject is always on the staff's side, also once their account is gone.
        subject:
          entry.kind === 'assignee'
            ? requestPerson(subject ?? { id: null, name: null }, 'staff', actor, pictures)
            : null,
        subjectIsAuthor:
          entry.kind === 'assignee' && Boolean(subject?.id) && subject?.id === author?.id,
      };
    },
  );
  const raisedSignedInAs = signedInAsOf(
    { signedInAs: found.createdSignedInAs, staff: raisedByStaff[0] ?? null },
    found.createdBy,
  );
  return {
    id: found.id,
    number: found.number,
    prefix,
    title: found.title,
    description: {
      text: found.description,
      format: found.descriptionFormat,
      mentions: mentionsOf.get(null),
      ...editsOf(
        null,
        found.description,
        found.descriptionEditedAt,
        mayEditDescription(permissions, found.status),
      ),
    },
    type: found.type,
    typeName: typeNames.get(found.type) ?? found.type,
    status: found.status,
    reopenedAt: found.reopenedAt,
    priority: internal ? found.priority : null,
    raisedBy: requestPerson(
      raisedBy[0] ?? { id: null, name: null },
      found.createdBySide,
      actor,
      pictures,
    ),
    ...(raisedSignedInAs && { raisedSignedInAs }),
    assignees: assignees.map((person) => requestPerson(person, 'staff', actor, pictures)),
    // Someone on the staff who is also in the company is a colleague to the company's readers.
    subscribers: subscribers.map(({ id, name, staff }) =>
      requestPerson({ id, name }, internal && staff ? 'staff' : 'company', actor, pictures),
    ),
    subscribed: following.some(({ id }) => id === actor.id),
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
    activity,
    entries,
    earlierEntries: firstRow(total, 'the entry count').total - entries.length,
  };
}
