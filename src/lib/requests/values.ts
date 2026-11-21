/**
 * @file The values a request can have: its statuses, types and priorities,
 * the two sides of a request, the kinds of entry in its history and what an
 * assignment entry records, the formats
 * its text is stored in and the status filters of a request list. Free of
 * dependencies, so the database schema, the services and client components
 * can all import it.
 */

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
 * waiting for the company's reply (`waiting`), and finished: `done`, or
 * `cancelled` when it isn't needed anymore.
 */
export const REQUEST_STATUSES = [
  'open',
  'todo',
  'in_progress',
  'waiting',
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
 * What a request is about. Built in for now, and stored as these keys so a
 * later list that staff manage can take them over.
 */
export const REQUEST_TYPES = ['hotfix', 'bug', 'support', 'new_feature'] as const;

/** One type of request. */
export type RequestType = (typeof REQUEST_TYPES)[number];

/**
 * Whether a value is a request type.
 *
 * @param value - The value to check.
 * @returns Whether it's one of {@link REQUEST_TYPES}.
 */
export function isRequestType(value: unknown): value is RequestType {
  return isOneOf(REQUEST_TYPES, value);
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

/** The priority a request of each type starts with, until staff change it. */
const STARTING_PRIORITIES: Record<RequestType, RequestPriority> = {
  hotfix: 'high',
  bug: 'normal',
  support: 'normal',
  new_feature: 'low',
};

/**
 * The priority a request of a type starts with. Whoever raises a request
 * chooses its type, not its priority; staff can change it afterwards.
 *
 * @param type - The request's type.
 * @returns The priority.
 */
export function startingPriority(type: RequestType): RequestPriority {
  return STARTING_PRIORITIES[type];
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
 * (`active`), those waiting for the company's reply (`waiting`), those done
 * or cancelled (`closed`), and every request (`all`).
 */
export const REQUEST_STATUS_FILTERS = ['active', 'waiting', 'closed', 'all'] as const;

/** One status filter. */
export type RequestStatusFilter = (typeof REQUEST_STATUS_FILTERS)[number];

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
  waiting: ['waiting'],
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
