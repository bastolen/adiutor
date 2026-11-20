/**
 * @file Requests: what companies raise with the staff and work through with
 * them. Listing them, reading one with its conversation, raising one,
 * replying to it, changing its status, correcting its details and assigning
 * it to staff members.
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
export { getRequestSettings, listRequestCompanies, listRequests } from './list';
export type { ListRequestsOptions, RequestCompany, RequestListItem } from './list';
export {
  findRequest,
  findRequestNumber,
  getRequest,
  MAX_EARLIER_CHUNKS,
  THREAD_CHUNK,
} from './detail';
export type { RequestDetail, RequestEntryView, RequestText } from './detail';
export { default as raiseRequest } from './raise';
export { default as replyToRequest } from './reply';
export { default as changeRequestStatus } from './status';
export { default as updateRequestDetails } from './details';
export {
  changeAssignees,
  countAssignedRequests,
  listAssignableStaff,
  MAX_ASSIGNEE_CHANGES,
  unassignFrom,
} from './assignees';
export type { AssignableStaffMember } from './assignees';
