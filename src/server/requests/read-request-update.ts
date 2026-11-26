/**
 * @file What one person's email about a request may show, decided again when
 * it's sent ({@link readRequestUpdate}, decision 0031): nothing for someone
 * who is no longer on the request or can no longer read it, and people by the
 * names the request's page gives them, never an address or an ID. Only the
 * staff read an internal request, which has no company (decision 0048), so
 * only they are told about one, and only they hear of an internal note
 * (decision 0032). What the email is read from is in
 * `request-update-context.ts`, what it's made of in `request-update.ts`;
 * who is told is decided in `tell-people.ts`.
 */
import { visibleName } from '@/lib/display-name';
import {
  DESCRIPTION_ANCHOR,
  entryAnchor,
  formatRequestNumber,
  isRequestStatus,
  mayAnswerSolution,
  requestAudience,
  requestSide,
  type RequestSide,
  type RequestTextFormat,
} from '@/lib/requests';

import type { ServiceContext } from '../context';
import getRequestPrefix from '../people/request-prefix';
import getStaffName from '../people/staff-name';
import currentProposalEntryId from './proposals';
import type {
  QueuedRequestNews,
  RequestUpdate,
  RequestUpdateItem,
  RequestUpdateText,
} from './request-update';
import {
  loadNewsAttachments,
  loadNewsEntries,
  loadNewsMentions,
  loadNewsRequest,
  type NewsContext,
  newsReader,
  permissionsInCompanyOf,
} from './request-update-context';

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
 * A text of the request with the people it mentions by name, and its files.
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
    attachments: context.attachments
      .filter((attachment) => attachment.entryId === entryId)
      .map(({ name, size }) => ({ name, size })),
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
  if (event === 'raised' && found.createdOnBehalf && found.createdBy === told.reader.id) {
    // The request says a staff member raised it, also once their account is gone.
    const raisedBy = told.people.find(({ id }) => id === byUserId);
    return {
      event,
      by: pageName(context, raisedBy?.name ?? null, 'staff'),
      text: updateText(context, found.description, found.descriptionFormat, null),
    };
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
  if ((item.event === 'mentioned' && item.where === 'description') || item.event === 'raised') {
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
  const [entries, mentions, attachments, staffName, prefix] = await Promise.all([
    loadNewsEntries(db, about.requestId, entryIds),
    loadNewsMentions(db, about.requestId, entryIds),
    loadNewsAttachments(db, about.requestId, entryIds),
    getStaffName(db),
    getRequestPrefix(db),
  ]);
  const { items, anchor, skipped } = tellNews(
    {
      found,
      told,
      entries: new Map(entries.map((entry) => [entry.id, entry])),
      mentions,
      attachments,
      // An internal request has nobody on the company's side to name.
      sideNames: { company: found.companyName ?? staffName, staff: staffName },
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
