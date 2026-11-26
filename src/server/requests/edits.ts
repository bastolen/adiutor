/**
 * @file Editing a request's texts: its description, which the staff who work
 * on requests and the company's people who take part may edit, and a reply,
 * which only its author may edit. Only while the request is open. Each edit
 * keeps the text it replaced as a version (`request_text_version`), which
 * only the staff read, and the text says when it was edited. See decision
 * 0024.
 *
 * A text's mentions are rows that belong to the text as it is (decision
 * 0023). An edit gives them back to the editor as mentions that are being
 * written (`editableText`), and stores them afresh with the new text; the
 * version keeps them as plain "@Name" text.
 *
 * A description or reply is stored without links to the staff's pages
 * (`withoutStaffPageLinks`), as when it was written: the company reads it.
 * An internal note keeps them, and so does every text of an internal request,
 * which only the staff read (decision 0048).
 *
 * An edit can also add files to the text (decision 0044): its writer's own
 * uploads, claimed like a new text's (`claimAttachments`). An edit that only
 * adds files keeps no version and doesn't mark the text edited.
 */
import { and, count, eq, inArray, isNull } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import { request, requestEntry, requestMention, requestTextVersion, user } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { visibleName } from '@/lib/display-name';
import { appUrl } from '@/lib/env';
import {
  editStoredMentions,
  mayEditDescription,
  mayEditNote,
  mayEditReply,
  nameStoredMentions,
  type RequestSide,
  requestSide,
  WRITTEN_ENTRY_KINDS,
  WRITTEN_TEXT_FORMAT,
  writtenMentionMarker,
} from '@/lib/requests';
import { idSchema, requestDescriptionSchema, requestReplySchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { notFoundError, ServiceError } from '../errors';
import getStaffName from '../people/staff-name';
import { signedInAsWork } from '../signed-in-as';
import claimAttachments from './attachment-claims';
import {
  assertChangeLimit,
  CHANGE_MOMENT,
  changeRequest,
  requestToChange,
  workingPermission,
} from './change';
import mentionKey from './mention-key';
import { storeMentions } from './mentions';
import withoutStaffPageLinks from './staff-links';
import { staffWhoReadNotes, tellMentioned } from './tell-people';

/** Someone a stored text mentions, as its mention row names them. */
export interface TextMention {
  /** The mention row's ID, which the text's marker names. */
  id: string;
  /** The side they were on. */
  side: RequestSide;
  /** Their account, while it exists. */
  person: { id: string | null; name: string | null } | null;
}

/** The names that stand in for someone without a name, or whose account is gone. */
interface SideNames {
  /** The request's company. */
  company: string;
  /** The name the staff are shown with. */
  staff: string;
}

/**
 * The name a mention shows: the person's own, or their side's.
 *
 * @param mention - The mention.
 * @param names - The names of the two sides.
 * @returns The name.
 */
function mentionName(mention: TextMention, names: SideNames): string {
  return visibleName(mention.person?.name) ?? names[mention.side];
}

/**
 * A stored text as it's given to its editor: each of its mentions as one
 * that's being written (the person's name and key), so the editor shows them
 * and they're stored afresh with the new text. A mention of an account
 * that's gone becomes plain text.
 *
 * @param stored - The text as it's stored.
 * @param mentions - The text's own mentions.
 * @param companyId - The request's company, which the keys are for; `null` for an internal
 *   request.
 * @param names - The names of the two sides.
 * @returns The text to edit.
 */
export function editableText(
  stored: string,
  mentions: readonly TextMention[],
  companyId: string | null,
  names: SideNames,
): string {
  const byId = new Map(mentions.map((mention) => [mention.id, mention]));
  return editStoredMentions(stored, (id) => {
    const mention = byId.get(id);
    if (!mention) {
      return null;
    }
    const name = mentionName(mention, names);
    return mention.person?.id
      ? writtenMentionMarker(name, mentionKey(companyId, mention.person.id))
      : `@${name}`;
  });
}

/** What an edit did. */
export interface EditResult {
  /** Whether the text or its files changed. */
  changed: boolean;
  /** How many files it added. */
  attached: number;
}

/** What an edit is about: the description (no entry), or a reply. */
interface EditedText {
  /** The request. */
  requestId: string;
  /** The reply; `null` for the description. */
  entryId: string | null;
  /** The text as it's stored. */
  stored: string;
  /** Its format. */
  format: 'plain' | 'markdown';
}

/**
 * Makes an edit inside its change's transaction: refuses an edit the rules
 * don't allow on the request as it's locked (by then that can only be a
 * closed request: the rest was checked before), and a text someone edited
 * meanwhile. Then it adds the files that came with the edit, and for a
 * changed text keeps the stored text as a version, stores the new one with
 * its mentions afresh, and notes when it was edited; an unchanged text
 * stays as it was. An edit doesn't move the request's last activity, and
 * files added to a text tell nobody: it corrects and completes what's there.
 *
 * @param tx - The change's transaction, with the request locked.
 * @param actor - The editor.
 * @param edit - What's edited.
 * @param edit.text - The text as it's stored now.
 * @param edit.written - The new text, as the editor sent it.
 * @param edit.edits - How many times the text had been edited when the editor started.
 * @param edit.allowed - Whether the rules allow the edit on the request as it's locked.
 * @param edit.companyId - The request's company; `null` for an internal request.
 * @param edit.side - The side the editor acts as.
 * @param edit.names - The names of the two sides.
 * @param edit.staffOnly - Whether only the staff read the text (an internal note): then only the
 *   staff it mentions are subscribed and told.
 * @param edit.attachments - Files the editor uploaded to add to the text.
 * @returns Whether the text or its files changed, and how many files were added.
 * @throws {ServiceError} `invalid` for a closed request (`errors.requests.closedNoEdit`),
 *   `conflict` when someone edited the text meanwhile (`errors.requests.textChanged`); `invalid`
 *   or `conflict` for files that can't be added (`claimAttachments`).
 */
async function applyEdit(
  tx: DatabaseTransaction,
  actor: Actor,
  edit: {
    text: EditedText;
    written: string;
    edits: number;
    allowed: boolean;
    companyId: string | null;
    side: RequestSide;
    names: SideNames;
    staffOnly: boolean;
    attachments: readonly string[];
  },
): Promise<EditResult> {
  const { text, written, companyId, names } = edit;
  if (!edit.allowed) {
    throw new ServiceError('invalid', 'errors.requests.closedNoEdit');
  }
  const ofText = and(
    eq(requestTextVersion.requestId, text.requestId),
    text.entryId === null
      ? isNull(requestTextVersion.entryId)
      : eq(requestTextVersion.entryId, text.entryId),
  );
  const edits = firstRow(
    await tx.select({ total: count() }).from(requestTextVersion).where(ofText),
    'the version count',
  ).total;
  if (edits !== edit.edits) {
    throw new ServiceError('conflict', 'errors.requests.textChanged');
  }
  const attached = await claimAttachments(
    tx,
    actor,
    { requestId: text.requestId, entryId: text.entryId },
    edit.attachments,
  );
  const mentionsOfText = and(
    eq(requestMention.requestId, text.requestId),
    text.entryId === null
      ? isNull(requestMention.entryId)
      : eq(requestMention.entryId, text.entryId),
  );
  const mentions: TextMention[] = await tx
    .select({
      id: requestMention.id,
      side: requestMention.side,
      person: { id: user.id, name: user.name },
    })
    .from(requestMention)
    .leftJoin(user, eq(requestMention.userId, user.id))
    .where(mentionsOfText);
  if (editableText(text.stored, mentions, companyId, names) === written) {
    return { changed: attached > 0, attached };
  }
  // The version keeps its mentions as names: their rows go with the text as it was.
  const byId = new Map(mentions.map((mention) => [mention.id, mention]));
  await tx.insert(requestTextVersion).values({
    requestId: text.requestId,
    entryId: text.entryId,
    body: nameStoredMentions(text.stored, (id) => {
      const mention = byId.get(id);
      return mention ? mentionName(mention, names) : null;
    }),
    bodyFormat: text.format,
    editedBy: actor.id,
    editedBySide: edit.side,
    ...signedInAsWork(actor),
    createdAt: CHANGE_MOMENT,
  });
  await tx.delete(requestMention).where(mentionsOfText);
  if (text.entryId === null) {
    await tx
      .update(request)
      .set({
        description: written,
        descriptionFormat: WRITTEN_TEXT_FORMAT,
        descriptionEditedAt: CHANGE_MOMENT,
      })
      .where(eq(request.id, text.requestId));
  } else {
    await tx
      .update(requestEntry)
      .set({ body: written, bodyFormat: WRITTEN_TEXT_FORMAT, editedAt: CHANGE_MOMENT })
      .where(eq(requestEntry.id, text.entryId));
  }
  // Whoever the text mentioned already isn't subscribed again for an edit, or told again.
  const before = mentions.flatMap(({ person }) => (person?.id ? [person.id] : []));
  const mentioned = await storeMentions(
    tx,
    actor,
    {
      companyId,
      requestId: text.requestId,
      entryId: text.entryId,
      written,
      staffOnly: edit.staffOnly,
    },
    before,
  );
  // Someone the edit mentions newly hears of it; of an internal note, only the staff do.
  const newlyMentioned = mentioned.filter((userId) => !before.includes(userId));
  await tellMentioned(
    tx,
    { requestId: text.requestId, entryId: text.entryId, actorId: actor.id },
    edit.staffOnly ? await staffWhoReadNotes(tx, newlyMentioned) : newlyMentioned,
  );
  return { changed: true, attached };
}

/**
 * Edits a request's description: the staff who work on requests and anyone
 * at the company who takes part may, while the request is open
 * (`mayEditDescription`). See {@link applyEdit} for what an edit does.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:contribute` in the request's company.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.text - The new description.
 * @param input.edits - How many times it had been edited when the editor started (the form's).
 * @param input.attachments - Files the actor uploaded to add to it (`claimAttachments`).
 * @returns Whether it changed, and how many files were added.
 * @throws {ServiceError} `signed_in_as` when the sign-in as the actor ended meanwhile,
 *   `not_found` when the actor may not see the request, `forbidden` without
 *   `requests:contribute`, `invalid` when the company is deactivated or the request is closed,
 *   `rate_limited` past `RATE_LIMITS.requestChangesPerUser`, `conflict` when someone edited it
 *   meanwhile; `invalid` or `conflict` for files that can't be added.
 * @throws {ZodError} When the description isn't valid.
 */
export async function editRequestDescription(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string; text: string; edits: number; attachments?: readonly string[] },
): Promise<EditResult> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:contribute');
  const typed = requestDescriptionSchema.parse(input.text);
  await assertChangeLimit(ctx, actor);
  const { permissions, company } = access;
  // The company reads it: a link to one of the staff's pages is kept as its text. Past the limit,
  // as reading the text costs time. Only the staff read an internal request, which keeps them.
  const written = company === null ? typed : withoutStaffPageLinks(typed, appUrl);
  const staff = await getStaffName(ctx.db);
  return changeRequest(ctx, actor, access, workingPermission(permissions), async (tx, locked) =>
    applyEdit(tx, actor, {
      text: {
        requestId: locked.id,
        entryId: null,
        stored: locked.description,
        format: locked.descriptionFormat,
      },
      written,
      edits: input.edits,
      allowed: mayEditDescription(permissions, locked.status),
      companyId: locked.companyId,
      side: requestSide(permissions),
      // An internal request has nobody on the company's side to name.
      names: { company: company?.name ?? staff, staff },
      staffOnly: false,
      attachments: input.attachments ?? [],
    }),
  );
}

/**
 * Edits a reply or an internal note: only the one who wrote it may, while
 * the request is open and they still take part or work on requests
 * (`mayEditReply`; for a note, while they still work on requests:
 * `mayEditNote`). Someone else's reply or note, or an entry that holds no
 * text, is "not found". See {@link applyEdit} for what an edit does.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:contribute` in the request's company.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.entry - The reply's ID.
 * @param input.text - The new reply.
 * @param input.edits - How many times it had been edited when the editor started (the form's).
 * @param input.attachments - Files the actor uploaded to add to it (`claimAttachments`).
 * @returns Whether it changed, and how many files were added.
 * @throws {ServiceError} `signed_in_as`, `not_found` when the actor may not see the request or
 *   the reply isn't theirs, `forbidden` without `requests:contribute`, `invalid` when the
 *   company is deactivated or the request is closed, `rate_limited`, `conflict` when they edited
 *   it meanwhile elsewhere; `invalid` or `conflict` for files that can't be added.
 * @throws {ZodError} When the reply isn't valid.
 */
export async function editReply(
  ctx: ServiceContext,
  actor: Actor,
  input: {
    request: string;
    entry: string;
    text: string;
    edits: number;
    attachments?: readonly string[];
  },
): Promise<EditResult> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:contribute');
  const entryId = idSchema.safeParse(input.entry);
  if (!entryId.success) {
    throw notFoundError();
  }
  const written = requestReplySchema.parse(input.text);
  await assertChangeLimit(ctx, actor);
  const { permissions, company } = access;
  // The company reads a reply: a link to one of the staff's pages is kept as its text. Read before
  // the request is locked, as reading the text costs time; whether it's a note is known once the
  // entry is read, in the lock. Only the staff read an internal request, which keeps them.
  const forCompany = company === null ? written : withoutStaffPageLinks(written, appUrl);
  const staff = await getStaffName(ctx.db);
  return changeRequest(ctx, actor, access, workingPermission(permissions), async (tx, locked) => {
    const [reply] = await tx
      .select({
        kind: requestEntry.kind,
        body: requestEntry.body,
        bodyFormat: requestEntry.bodyFormat,
      })
      .from(requestEntry)
      .where(
        and(
          eq(requestEntry.id, entryId.data),
          eq(requestEntry.requestId, locked.id),
          inArray(requestEntry.kind, [...WRITTEN_ENTRY_KINDS]),
          eq(requestEntry.authorId, actor.id),
        ),
      );
    if (!reply || reply.body === null) {
      throw notFoundError();
    }
    return applyEdit(tx, actor, {
      text: {
        requestId: locked.id,
        entryId: entryId.data,
        stored: reply.body,
        format: reply.bodyFormat,
      },
      // A note, which only the staff read, keeps its links to the staff's pages.
      written: reply.kind === 'note' ? written : forCompany,
      edits: input.edits,
      // The query above found the reply or note only as the actor's own.
      allowed: (reply.kind === 'note' ? mayEditNote : mayEditReply)(
        permissions,
        locked.status,
        true,
      ),
      companyId: locked.companyId,
      side: requestSide(permissions),
      names: { company: company?.name ?? staff, staff },
      staffOnly: reply.kind === 'note',
      attachments: input.attachments ?? [],
    });
  });
}
