/**
 * @file The values a request can have: its statuses, types and priorities,
 * the two sides of a request, the kinds of entry in its history and what an
 * assignment entry records, the formats
 * its text is stored in, the status filters of a request list and the
 * choice that stands for internal requests. Free of
 * dependencies but the input rules (which have none), so the database schema,
 * the services and client components can all import it.
 */
import { latinWords } from '../input-rules';

/**
 * Whether a value is one of a list's values.
 *
 * @param values - The list.
 * @param value - The value to check.
 * @returns Whether the list has it.
 */
function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return (values as readonly unknown[]).includes(value);
}

/**
 * A request's statuses, in the order a request moves through them: raised
 * (`open`), accepted by the staff (`todo`), being worked on (`in_progress`),
 * waiting for the company's reply (`waiting`), waiting for the company to
 * approve the solution the staff sent (`proposed`, decision 0033), and
 * finished: `done`, or `cancelled` when it isn't needed anymore.
 */
export const REQUEST_STATUSES = [
  'open',
  'todo',
  'in_progress',
  'waiting',
  'proposed',
  'done',
  'cancelled',
] as const;

/** One status of a request. */
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** The statuses of a request nobody works on anymore: done or cancelled. */
export const CLOSED_REQUEST_STATUSES = [
  'done',
  'cancelled',
] as const satisfies readonly RequestStatus[];

/**
 * Whether a status is one of a request nobody works on anymore.
 *
 * @param status - The status.
 * @returns Whether it's done or cancelled.
 */
export function isClosedStatus(status: RequestStatus): boolean {
  return isOneOf(CLOSED_REQUEST_STATUSES, status);
}

/** The statuses of a request that still needs something: every status that isn't closed. */
export const ACTIVE_REQUEST_STATUSES: readonly RequestStatus[] = REQUEST_STATUSES.filter(
  (status) => !isClosedStatus(status),
);

/**
 * Whether a value is a request status.
 *
 * @param value - The value to check.
 * @returns Whether it's one of {@link REQUEST_STATUSES}.
 */
export function isRequestStatus(value: unknown): value is RequestStatus {
  return isOneOf(REQUEST_STATUSES, value);
}

/**
 * The form of a request type's key: lower-case letters, digits and
 * underscores, at most 40 characters. A key never changes once its type is
 * added: requests, their history and the list's `?type=` filter hold it.
 * Which types there are is data (`request_type`), never a list in code.
 */
export const REQUEST_TYPE_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

/** The longest key a type gets from its name, leaving room for a number added to it. */
const KEY_FROM_NAME_MAX_LENGTH = 32;

/**
 * Whether a value has the form of a request type's key. It says nothing about
 * whether a type with that key exists; the services look that up.
 *
 * @param value - The value to check.
 * @returns Whether it's a well-formed key.
 */
export function isRequestTypeKey(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_TYPE_KEY_PATTERN.test(value);
}

/**
 * The key a new request type gets from its name: its letters and digits
 * without accents, in lower case, with underscores between words, and a
 * number added when the key is taken ("Printers" becomes `printers`, then
 * `printers_2`). A name without a letter or digit to use (only symbols, or a
 * script without a Latin form) becomes `type`.
 *
 * @param name - The type's name.
 * @param taken - Whether a key is taken already (by any type, archived ones too).
 * @returns A key that isn't taken.
 */
export function requestTypeKeyFromName(name: string, taken: (key: string) => boolean): string {
  const base =
    latinWords(name, '_').slice(0, KEY_FROM_NAME_MAX_LENGTH).replace(/_+$/, '') || 'type';
  if (!taken(base)) {
    return base;
  }
  let number = 2;
  while (taken(`${base}_${number}`)) {
    number += 1;
  }
  return `${base}_${number}`;
}

/** How urgent a request is, from least to most. Only staff set and see it. */
export const REQUEST_PRIORITIES = ['low', 'normal', 'high'] as const;

/** One priority. */
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

/**
 * Whether a value is a request priority.
 *
 * @param value - The value to check.
 * @returns Whether it's one of {@link REQUEST_PRIORITIES}.
 */
export function isRequestPriority(value: unknown): value is RequestPriority {
  return isOneOf(REQUEST_PRIORITIES, value);
}

/**
 * The two sides of a request: the company that raised it and the staff who
 * handle it. Stored with everything someone writes or changes, so the
 * history still says which side it came from after their account is deleted
 * or their role changes.
 */
export const REQUEST_SIDES = ['company', 'staff'] as const;

/** One side of a request. */
export type RequestSide = (typeof REQUEST_SIDES)[number];

/**
 * The kinds of entry in a request's history: a comment (a reply), an
 * internal note only the staff read (`note`), a change of its status,
 * title, type or priority, or someone assigned to it or removed from it
 * (`assignee`).
 */
export const REQUEST_ENTRY_KINDS = [
  'comment',
  'note',
  'status',
  'title',
  'type',
  'priority',
  'assignee',
] as const;

/** One kind of history entry. */
export type RequestEntryKind = (typeof REQUEST_ENTRY_KINDS)[number];

/**
 * The kinds of entry that hold a text someone wrote: a reply and an
 * internal note. Each has a body; no other kind has one.
 */
export const WRITTEN_ENTRY_KINDS = [
  'comment',
  'note',
] as const satisfies readonly RequestEntryKind[];

/** A kind of entry that holds a text. */
export type WrittenEntryKind = (typeof WRITTEN_ENTRY_KINDS)[number];

/**
 * The kinds of entry only readers with `requests:view-internal` (the staff)
 * see: a change of priority and an internal note. The services leave them
 * out of everything a company user gets (the conversation, the count of
 * earlier entries, the staff a company writer may mention), and they never
 * count as the request's last activity.
 */
export const STAFF_ONLY_ENTRY_KINDS = [
  'priority',
  'note',
] as const satisfies readonly RequestEntryKind[];

/**
 * What someone on a request is there as: assigned to it (a staff member who
 * works on it), or subscribed to it (anyone who follows it). Someone can be
 * both. Everyone on a request is who a later notification about it reaches.
 */
export const REQUEST_PARTICIPANT_ROLES = ['assignee', 'subscriber'] as const;

/** One role on a request. */
export type RequestParticipantRole = (typeof REQUEST_PARTICIPANT_ROLES)[number];

/**
 * What an `assignee` entry records about the staff member it's about: that
 * they were assigned to the request, or removed from it. Stored as the
 * entry's new value, so every change keeps one.
 */
export const ASSIGNMENT_CHANGES = ['assigned', 'unassigned'] as const;

/** One assignment change. */
export type AssignmentChange = (typeof ASSIGNMENT_CHANGES)[number];

/**
 * Whether a value is an assignment change.
 *
 * @param value - The value to check.
 * @returns Whether it's one of {@link ASSIGNMENT_CHANGES}.
 */
export function isAssignmentChange(value: unknown): value is AssignmentChange {
  return isOneOf(ASSIGNMENT_CHANGES, value);
}

/**
 * The formats a description or comment is stored in: plain text, as every
 * text was written before Markdown, and Markdown. The format is stored with
 * each text, so a text is never read as a format it wasn't written in.
 */
export const REQUEST_TEXT_FORMATS = ['plain', 'markdown'] as const;

/** One text format. */
export type RequestTextFormat = (typeof REQUEST_TEXT_FORMATS)[number];

/**
 * The format every new description and reply is written in. Nobody chooses
 * one: a text is Markdown from the moment Markdown exists, and the texts
 * stored before it keep `plain`.
 */
export const WRITTEN_TEXT_FORMAT: RequestTextFormat = 'markdown';

/**
 * The status filters of a request list: requests that still need something
 * (`active`), those waiting for the company (`waiting`: its reply, or its
 * approval of a solution), those done
 * or cancelled (`closed`), and every request (`all`).
 */
export const REQUEST_STATUS_FILTERS = ['active', 'waiting', 'closed', 'all'] as const;

/** One status filter. */
export type RequestStatusFilter = (typeof REQUEST_STATUS_FILTERS)[number];

/**
 * The query parameter that shows a request list's requests of one status
 * (`?only=done`), instead of a status filter's group: where a lane of the
 * board links to. Its own parameter, since `waiting` is both a group and a
 * status.
 */
export const ONLY_STATUS_PARAM = 'only';

/**
 * What the new-request form's company select and the request lists' Company
 * filter send for internal requests, the staff's own without a company
 * (decision 0048), in place of a company's URL name. No URL name can be it
 * (`slugSchema` takes lowercase letters, digits and hyphens between them),
 * and it isn't an ID.
 */
export const INTERNAL_CHOICE = '_internal';

/** The filter a request list opens with. */
export const DEFAULT_REQUEST_STATUS_FILTER: RequestStatusFilter = 'active';

/**
 * Whether a value is a status filter.
 *
 * @param value - The value to check.
 * @returns Whether it's one of {@link REQUEST_STATUS_FILTERS}.
 */
export function isRequestStatusFilter(value: unknown): value is RequestStatusFilter {
  return isOneOf(REQUEST_STATUS_FILTERS, value);
}

/** The statuses each filter shows; `null` shows every status. */
const FILTER_STATUSES: Record<RequestStatusFilter, readonly RequestStatus[] | null> = {
  active: ACTIVE_REQUEST_STATUSES,
  waiting: ['waiting', 'proposed'],
  closed: CLOSED_REQUEST_STATUSES,
  all: null,
};

/**
 * The statuses a status filter shows.
 *
 * @param filter - The filter.
 * @returns The statuses, or `null` when the filter shows every status.
 */
export function statusesOfFilter(filter: RequestStatusFilter): readonly RequestStatus[] | null {
  return FILTER_STATUSES[filter];
}
