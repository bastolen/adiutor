/**
 * @file Requests: what companies raise with the staff and work through with
 * them. Listing them, reading one with its conversation, and raising one.
 *
 * Who sees what: the staff see every company's requests, a company's members
 * their own company's while it's active, and a request someone may not see
 * is reported as not found. Only the staff see a request's priority. People
 * appear by name and side, never by email address: a company's Clients and
 * Watchers can't see its member list.
 *
 * This is the module's public API: the code lives in the files next to it,
 * and nothing outside this folder imports them directly. The values and
 * rules of requests are in `src/lib/requests`.
 */
export type { RequestPerson } from './access';
export { listRequestCompanies, listRequests } from './list';
export type { ListRequestsOptions, RequestCompany, RequestListItem } from './list';
export { findRequest, getRequest, MAX_EARLIER_CHUNKS, THREAD_CHUNK } from './detail';
export type { RequestDetail, RequestEntryView, RequestText } from './detail';
export { default as raiseRequest } from './raise';
