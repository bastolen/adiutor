/**
 * @file A request's texts as their reader gets them: the description, and
 * each reply's or internal note's text, with the people it mentions, its
 * earlier versions (for the staff), the files attached to it, and, for a
 * reader who may edit it, what its editor starts from. What only the staff
 * see is left out for everyone else (`ofShownText`). Part of reading one
 * request (`getRequest` in `detail.ts`); the entries the replies and notes
 * belong to are in `detail-thread.ts`.
 */
import { and, asc, desc, eq, isNull, notInArray, or, type SQL } from 'drizzle-orm';

import {
  requestAttachment,
  requestEntry,
  requestMention,
  requestTextVersion,
  user,
} from '@/db/schema';
import { appUrl } from '@/lib/env';
import { mayContribute, type RequestTextFormat, STAFF_ONLY_ENTRY_KINDS } from '@/lib/requests';

import type { Company } from '../access';
import type { ServiceContext } from '../context';
import { type RequestPerson, requestPerson, type RequestRow } from './access';
import {
  type PageReader,
  signedInAsMark,
  type SignedInAsMark,
  signedInAsStaff,
} from './detail-reader';
import { editableText, type TextMention } from './edits';
import mentionKey from './mention-key';
import { withoutStaffPageLinksToEdit } from './staff-links';

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

/**
 * A file attached to a request's text, as its reader gets it (decision
 * 0044): to download from `/attachments/<id>`, with its preview at
 * `/attachments/<id>/preview` when it has one (decision 0057), or, once it's
 * removed, who removed it and when. Never who uploaded it: that's the text's
 * author, or whoever added it while editing the text.
 */
export interface RequestAttachmentView {
  /** Its ID, which its address holds. */
  id: string;
  /** Its name. */
  name: string;
  /** Its size in bytes. */
  size: number;
  /** Whether it has a preview, which its tile shows (none once it's removed). */
  preview: boolean;
  /**
   * Who removed it and when, once it's removed (its file is gone then);
   * `null` while it's there. A staff member removes files, so `by` is on the
   * staff's side; whether they did it while signed in as someone, only for
   * the readers who may know.
   */
  removed: { by: RequestPerson; at: Date; signedInAs?: SignedInAsMark } | null;
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
  /** The files attached to it, oldest first; left out for a text without any. */
  attachments?: RequestAttachmentView[];
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
  entryId:
    | typeof requestMention.entryId
    | typeof requestTextVersion.entryId
    | typeof requestAttachment.entryId,
): SQL | undefined {
  return internal
    ? undefined
    : or(isNull(entryId), notInArray(requestEntry.kind, [...STAFF_ONLY_ENTRY_KINDS]));
}

/**
 * Loads what the texts the reader is shown come with ({@link ofShownText}):
 * the people each mentions, each one's earlier versions, newest first, and
 * the files attached to each, oldest first (sent ones only).
 * Every reader gets the versions' rows, since the newest says who made the
 * last edit and how and their number is what an edit sends back; only the
 * staff get the versions themselves ({@link requestText}).
 *
 * @param ctx - Service context.
 * @param requestId - The request.
 * @param internal - Whether the reader sees what only the staff see.
 * @returns The mentions', the versions' and the attachments' rows.
 */
export async function loadTextRows(ctx: ServiceContext, requestId: string, internal: boolean) {
  const [mentioned, versions, attached] = await Promise.all([
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
    ctx.db
      .select({
        id: requestAttachment.id,
        entryId: requestAttachment.entryId,
        name: requestAttachment.name,
        size: requestAttachment.size,
        preview: requestAttachment.preview,
        removedAt: requestAttachment.removedAt,
        removedBy: { id: user.id, name: user.name },
        removedSignedInAs: requestAttachment.removedSignedInAs,
        removedSignedInAsStaff: { name: signedInAsStaff.name },
      })
      .from(requestAttachment)
      .leftJoin(user, eq(requestAttachment.removedBy, user.id))
      .leftJoin(signedInAsStaff, eq(requestAttachment.removedSignedInAsStaffId, signedInAsStaff.id))
      .leftJoin(requestEntry, eq(requestAttachment.entryId, requestEntry.id))
      .where(
        and(
          eq(requestAttachment.requestId, requestId),
          ofShownText(internal, requestAttachment.entryId),
        ),
      )
      .orderBy(asc(requestAttachment.createdAt), asc(requestAttachment.id)),
  ]);
  return { mentioned, versions, attached };
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
  /** The files attached to each text, oldest first. */
  attachments: Map<string | null, RequestAttachmentView[]>;
}

/**
 * Sorts the mentions and versions of a request's texts by text, as the
 * reader gets them. A mention shows a name, never a picture. A reader who
 * may write here gets each person's key too, so a mention they copy into a
 * text stays one (nothing is written for a deactivated company); someone
 * without an account or a name to show can't be mentioned, so has none.
 *
 * @param reader - Who reads them.
 * @param company - The request's company; `null` for an internal request.
 * @param rows - The texts' mentions, versions and attachments ({@link loadTextRows}).
 * @returns The texts' mentions, versions and attachments, by text.
 */
export function shownTexts(
  reader: PageReader,
  company: Company | null,
  rows: Awaited<ReturnType<typeof loadTextRows>>,
): ShownTexts {
  const writes = mayContribute(
    reader.permissions,
    company && { deactivated: company.deactivatedAt !== null },
  );
  const companyId = company?.id ?? null;
  const texts: ShownTexts = {
    mentions: new Map(),
    storedMentions: new Map(),
    versions: new Map(),
    attachments: new Map(),
  };
  rows.mentioned.forEach(({ entryId, ...mention }) => {
    const { id, side, person } = mention;
    const ofText = texts.mentions.get(entryId) ?? {};
    const asShown = requestPerson(person ?? { id: null, name: null }, side, reader.actor);
    ofText[id] = {
      ...asShown,
      key: writes && person?.id && asShown.name !== null ? mentionKey(companyId, person.id) : null,
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
  rows.attached.forEach((row) => {
    const ofText = texts.attachments.get(row.entryId) ?? [];
    let removed: RequestAttachmentView['removed'] = null;
    if (row.removedAt) {
      const mark = signedInAsMark(
        reader,
        { signedInAs: row.removedSignedInAs, staff: row.removedSignedInAsStaff },
        row.removedBy?.id,
      );
      removed = {
        by: requestPerson(row.removedBy ?? { id: null, name: null }, 'staff', reader.actor),
        at: row.removedAt,
        ...(mark && { signedInAs: mark }),
      };
    }
    ofText.push({
      id: row.id,
      name: row.name,
      size: row.size,
      preview: row.preview === 'drawn' && !row.removedAt,
      removed,
    });
    texts.attachments.set(row.entryId, ofText);
  });
  return texts;
}

/** What the parts of a request's page are built from, once everything is loaded. */
export interface PageContext {
  /** Who reads it. */
  reader: PageReader;
  /** The request. */
  found: RequestRow;
  /** Its company; `null` for an internal request. */
  company: Company | null;
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
 * may open them, or it's an internal note or an internal request's text),
 * its versions (staff), and the files attached to it.
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
export function requestText(
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
  const attachments = texts.attachments.get(stored.entryId);
  // The newest version is the last edit's.
  const lastEdit = versions[0];
  // Nothing of a deactivated company's request changes, so nothing of it is edited.
  const editable = company === null || company.deactivatedAt === null;
  // Only a reader who may open the staff's pages gets a text to edit with links to them (and a
  // note, or an internal request's text, which only the staff read, keeps them for whoever edits it).
  const keepsStaffLinks =
    reader.globalPermissions.has('users:view') || stored.staffOnly || company === null;
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
            company?.id ?? null,
            // An internal request has nobody on the company's side to name.
            { company: company?.name ?? page.staffName, staff: page.staffName },
          ),
          edits: versions.length,
        },
      }),
    ...(reader.internal && versions.length > 0 && { versions }),
    ...(attachments && { attachments }),
  };
}
