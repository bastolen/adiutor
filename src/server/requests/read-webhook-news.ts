/**
 * @file What a webhook is told about a request: the news one tick queued for
 * it, read when it's sent, the way an email about a request is
 * (`readRequestUpdate`, decision 0031). The queued news holds IDs only; here
 * they become the request as it is now and each event in order, with people
 * by the names the request's page gives them (their own, or their side's
 * once the account is gone) and the people a text mentions by name. Never an
 * email address or a user ID, and never who did something while signed in as
 * someone else (decision 0028): a webhook isn't one of the readers who may
 * know. Webhooks are the staff's (decision 0046), so internal notes and
 * priorities are in it, for the webhooks that chose them, and so are internal
 * requests, which have no company (decision 0048).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { DatabaseOrTransaction } from '@/db';
import { company, request, requestEntry, requestMention, user } from '@/db/schema';
import { visibleName } from '@/lib/display-name';
import {
  entryAnchor,
  formatRequestNumber,
  isRequestPriority,
  isRequestStatus,
  nameStoredMentions,
  requestPathAt,
  type RequestPriority,
  type RequestSide,
  type RequestStatus,
  type RequestTextFormat,
} from '@/lib/requests';
import { WEBHOOK_EVENT_OF_ENTRY, type WebhookEvent } from '@/lib/webhooks';

import getRequestPrefix from '../people/request-prefix';
import getStaffName from '../people/staff-name';
import { requestTypeNames } from './types';

/** One piece of news queued for a webhook: what happened, and the entry it's about. */
export interface QueuedWebhookNews {
  /** What happened. */
  event: WebhookEvent;
  /** The entry of the request's history it's about; `null` for the request being raised. */
  entryId: string | null;
}

/** Someone as the request's page names them. */
export interface WebhookPerson {
  /** Their name, or their side's once the account is gone. */
  name: string;
  /** The side they acted as. */
  side: RequestSide;
}

/** A text of the request, with the people it mentions as "@" and their name. */
export interface WebhookText {
  /** The format it's written in. */
  format: RequestTextFormat;
  /** The text. */
  text: string;
}

/** A request type, by its key and its name. */
export interface WebhookRequestType {
  /** The key, which never changes. */
  key: string;
  /** Its name. */
  name: string;
}

/** What one event says, as of when it happened, in the order of the request's history. */
export type WebhookNewsEvent =
  | {
      /** The request was raised. */
      type: 'raised';
      /** The request's ID. */
      id: string;
      /** When. */
      at: Date;
      /** Who raised it. */
      by: WebhookPerson;
      /** Its description. */
      text: WebhookText;
    }
  | {
      /** Someone replied, or (`note`) wrote an internal note. */
      type: 'reply' | 'note';
      /** The entry's ID. */
      id: string;
      /** When. */
      at: Date;
      /** Who. */
      by: WebhookPerson;
      /** What they wrote, as it is now. */
      text: WebhookText;
    }
  | {
      /** Someone changed the status. */
      type: 'status';
      /** The entry's ID. */
      id: string;
      /** When. */
      at: Date;
      /** Who. */
      by: WebhookPerson;
      /** The status it had. */
      from: RequestStatus;
      /** The status it got. */
      to: RequestStatus;
    }
  | {
      /** Someone assigned a staff member to the request, or removed one. */
      type: 'assignee';
      /** The entry's ID. */
      id: string;
      /** When. */
      at: Date;
      /** Who. */
      by: WebhookPerson;
      /** Whether the staff member was assigned or removed. */
      change: 'assigned' | 'unassigned';
      /** The staff member's name, or `null` once their account is gone. */
      person: string | null;
    }
  | {
      /** Someone changed the title, the type or the priority. */
      type: 'details';
      /** The entry's ID. */
      id: string;
      /** When. */
      at: Date;
      /** Who. */
      by: WebhookPerson;
      /** Which. */
      field: 'title';
      /** The title it had. */
      from: string;
      /** The title it got. */
      to: string;
    }
  | {
      /** See above. */
      type: 'details';
      /** The entry's ID. */
      id: string;
      /** When. */
      at: Date;
      /** Who. */
      by: WebhookPerson;
      /** Which. */
      field: 'type';
      /** The type it had. */
      from: WebhookRequestType;
      /** The type it got. */
      to: WebhookRequestType;
    }
  | {
      /** See above. */
      type: 'details';
      /** The entry's ID. */
      id: string;
      /** When. */
      at: Date;
      /** Who. */
      by: WebhookPerson;
      /** Which. */
      field: 'priority';
      /** The priority it had. */
      from: RequestPriority;
      /** The priority it got. */
      to: RequestPriority;
    };

/** What a webhook is told about a request. */
export interface WebhookNews {
  /** The request, as it is now. */
  request: {
    /** Its ID. */
    id: string;
    /** Its number. */
    number: number;
    /** Its number as people see it, e.g. "AD-142". */
    reference: string;
    /** Its title. */
    title: string;
    /** Its status. */
    status: RequestStatus;
    /** Its type. */
    type: WebhookRequestType;
    /** Its priority. */
    priority: RequestPriority;
    /** Its company; `null` for an internal request, which has none (decision 0048). */
    company: { id: string; name: string } | null;
    /**
     * The path of its page, opened at the first event that has a place
     * there (`/requests/142?entry=<ID>#entry-<ID>`); never a link that signs
     * anyone in.
     */
    path: string;
    /** When it was raised. */
    raisedAt: Date;
    /** When it last changed for everyone who reads it. */
    lastActivityAt: Date;
  };
  /** What happened, in the order of the request's history. */
  events: WebhookNewsEvent[];
}

/**
 * Loads the request news is about, with its company (none for an internal
 * request) and who raised it.
 *
 * @param db - Database client.
 * @param requestId - The request.
 * @returns The request, or `undefined` when it's gone.
 */
async function loadRequest(db: DatabaseOrTransaction, requestId: string) {
  const [found] = await db
    .select({
      id: request.id,
      number: request.number,
      title: request.title,
      description: request.description,
      descriptionFormat: request.descriptionFormat,
      type: request.type,
      priority: request.priority,
      status: request.status,
      companyId: request.companyId,
      companyName: company.name,
      createdAt: request.createdAt,
      lastActivityAt: request.lastActivityAt,
      createdByName: user.name,
      createdBySide: request.createdBySide,
    })
    .from(request)
    .leftJoin(company, eq(request.companyId, company.id))
    .leftJoin(user, eq(request.createdBy, user.id))
    .where(eq(request.id, requestId));
  return found;
}

/** The staff member an assignment is about, apart from its author. */
const subject = alias(user, 'subject');

/**
 * Loads the entries news is about, with the names of their authors and of
 * whom an assignment is about.
 *
 * @param db - Database client.
 * @param requestId - The request.
 * @param entryIds - The entries.
 * @returns Their rows, in no order; none that's gone.
 */
function loadEntries(db: DatabaseOrTransaction, requestId: string, entryIds: readonly string[]) {
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
          authorName: user.name,
          authorSide: requestEntry.authorSide,
          subjectName: subject.name,
          createdAt: requestEntry.createdAt,
        })
        .from(requestEntry)
        .leftJoin(user, eq(requestEntry.authorId, user.id))
        .leftJoin(subject, eq(requestEntry.subjectUserId, subject.id))
        .where(and(eq(requestEntry.requestId, requestId), inArray(requestEntry.id, [...entryIds])));
}

/**
 * Loads the names of the people the request's texts mention.
 *
 * @param db - Database client.
 * @param requestId - The request.
 * @param sideNames - The names that stand in for someone whose account is gone.
 * @returns Each mention's name, by the ID its marker holds.
 */
async function loadMentionNames(
  db: DatabaseOrTransaction,
  requestId: string,
  sideNames: Record<RequestSide, string>,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: requestMention.id, side: requestMention.side, name: user.name })
    .from(requestMention)
    .leftJoin(user, eq(requestMention.userId, user.id))
    .where(eq(requestMention.requestId, requestId));
  return new Map(rows.map(({ id, side, name }) => [id, visibleName(name) ?? sideNames[side]]));
}

/**
 * Reads what a webhook is told about a request, as it is now: the request,
 * and the events of its queued news in the order of the request's history.
 * News that's no longer there is left out: an entry that's gone, or one
 * that isn't the event it was queued as.
 *
 * @param db - Database client.
 * @param requestId - The request.
 * @param news - The webhook's queued news about it.
 * @returns What to tell, or `null` when the request is gone or nothing is left.
 */
export async function readWebhookNews(
  db: DatabaseOrTransaction,
  requestId: string,
  news: readonly QueuedWebhookNews[],
): Promise<WebhookNews | null> {
  const found = await loadRequest(db, requestId);
  if (!found || !isRequestStatus(found.status)) {
    return null;
  }
  const entryIds = [...new Set(news.flatMap(({ entryId }) => (entryId ? [entryId] : [])))];
  const [entries, staffName, prefix, typeNames] = await Promise.all([
    loadEntries(db, requestId, entryIds),
    getStaffName(db),
    getRequestPrefix(db),
    requestTypeNames(db),
  ]);
  // An internal request has nobody on the company's side to name.
  const sideNames: Record<RequestSide, string> = {
    company: found.companyName ?? staffName,
    staff: staffName,
  };
  const mentionNames = await loadMentionNames(db, requestId, sideNames);
  /**
   * A text with the people it mentions named, so no marker (and no row ID) is left in it.
   *
   * @param text - The text, as it's stored.
   * @param format - Its format.
   * @returns The text to send.
   */
  const named = (text: string, format: RequestTextFormat): WebhookText => ({
    format,
    text: nameStoredMentions(text, (id) => mentionNames.get(id) ?? sideNames.staff),
  });
  /**
   * A type by its key and name.
   *
   * @param key - The type's key.
   * @returns The type.
   */
  const typeOf = (key: string): WebhookRequestType => ({ key, name: typeNames.get(key) ?? key });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const raised = news.some(({ event, entryId }) => event === 'raised' && entryId === null);
  const told = entryIds
    .flatMap((id) => {
      const entry = byId.get(id);
      return entry &&
        news.some(
          (piece) => piece.entryId === id && piece.event === WEBHOOK_EVENT_OF_ENTRY[entry.kind],
        )
        ? [entry]
        : [];
    })
    // Entry IDs are time-ordered: this is the order of the request's history.
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const events: WebhookNewsEvent[] = [
    ...(raised
      ? [
          {
            type: 'raised' as const,
            id: found.id,
            at: found.createdAt,
            by: {
              name: visibleName(found.createdByName) ?? sideNames[found.createdBySide],
              side: found.createdBySide,
            },
            text: named(found.description, found.descriptionFormat),
          },
        ]
      : []),
    ...told.flatMap((entry): WebhookNewsEvent[] => {
      const base = {
        id: entry.id,
        at: entry.createdAt,
        by: {
          name: visibleName(entry.authorName) ?? sideNames[entry.authorSide],
          side: entry.authorSide,
        },
      };
      const { from, to } = entry;
      switch (entry.kind) {
        case 'comment':
        case 'note':
          return entry.body === null
            ? []
            : [
                {
                  ...base,
                  type: entry.kind === 'comment' ? 'reply' : 'note',
                  text: named(entry.body, entry.bodyFormat),
                },
              ];
        case 'status':
          return isRequestStatus(from) && isRequestStatus(to)
            ? [{ ...base, type: 'status', from, to }]
            : [];
        case 'assignee':
          return [
            {
              ...base,
              type: 'assignee',
              change: to === 'unassigned' ? 'unassigned' : 'assigned',
              person: visibleName(entry.subjectName),
            },
          ];
        case 'title':
          return [{ ...base, type: 'details', field: 'title', from: from ?? '', to: to ?? '' }];
        case 'type':
          return from !== null && to !== null
            ? [{ ...base, type: 'details', field: 'type', from: typeOf(from), to: typeOf(to) }]
            : [];
        case 'priority':
          return isRequestPriority(from) && isRequestPriority(to)
            ? [{ ...base, type: 'details', field: 'priority', from, to }]
            : [];
        default:
          return [];
      }
    }),
  ];
  if (events.length === 0) {
    return null;
  }
  const [firstEntry] = told;
  return {
    request: {
      id: found.id,
      number: found.number,
      reference: formatRequestNumber(prefix, found.number),
      title: found.title,
      status: found.status,
      type: typeOf(found.type),
      priority: found.priority,
      company:
        found.companyId === null || found.companyName === null
          ? null
          : { id: found.companyId, name: found.companyName },
      path: requestPathAt(found.number, firstEntry ? entryAnchor(firstEntry.id) : null),
      raisedAt: found.createdAt,
      lastActivityAt: found.lastActivityAt,
    },
    events,
  };
}
