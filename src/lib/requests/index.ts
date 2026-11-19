/**
 * @file Requests: what companies raise with the staff and work through with
 * them. This is the module's public API: the values a request can have, the
 * rules of working on one, its number and its text. The code lives in the
 * files next to it, and nothing outside this folder imports them directly.
 *
 * Everything here is free of zod and of server code, so the database schema,
 * the services and client components can all import it. Not to be confused
 * with `src/lib/request/`, which is about HTTP requests.
 */
export {
  ACTIVE_REQUEST_STATUSES,
  CLOSED_REQUEST_STATUSES,
  DEFAULT_REQUEST_STATUS_FILTER,
  isClosedStatus,
  isRequestPriority,
  isRequestStatus,
  isRequestStatusFilter,
  isRequestType,
  REQUEST_ENTRY_KINDS,
  REQUEST_PRIORITIES,
  REQUEST_SIDES,
  REQUEST_STATUS_FILTERS,
  REQUEST_STATUSES,
  REQUEST_TEXT_FORMATS,
  REQUEST_TYPES,
  startingPriority,
  statusesOfFilter,
  WRITTEN_TEXT_FORMAT,
} from './values';
export type {
  RequestEntryKind,
  RequestPriority,
  RequestSide,
  RequestStatus,
  RequestStatusFilter,
  RequestTextFormat,
  RequestType,
} from './values';
export {
  isReopening,
  mayChangeStatus,
  maySetStatus,
  requestAudience,
  requestSide,
  statusAfterReply,
  statusChoices,
} from './rules';
export type { RequestAudience } from './rules';
export {
  DEFAULT_REQUEST_PREFIX,
  formatRequestNumber,
  parseRequestNumber,
  REQUEST_PREFIX_PATTERN,
  requestNumberStartInSearch,
  requestPath,
} from './number';
export { cleanMultilineText, linkTarget, splitLinks } from './text';
export type { TextPart } from './text';
