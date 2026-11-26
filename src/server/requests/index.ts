/**
 * @file Requests: what companies raise with the staff and work through with
 * them. Listing them, showing them as a board, reading one with its conversation, raising one,
 * replying to it, changing its status, correcting its details, editing its
 * texts, assigning it to staff members, subscribing to it, what an email
 * about it may tell someone on it, and how each reader reads its activity.
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
export { setActivityView } from './activity-view';
export { getRequestSettings, listRequestCompanies, listRequests } from './list';
export { listBoard } from './board';
export type { BoardCard, BoardLane, ListBoardOptions } from './board';
export type { ListRequestsOptions, RequestCompany, RequestListItem } from './list';
export { findRequest, findRequestNumber, getRequest } from './detail';
export type { RequestDetail } from './detail';
export type { SignedInAsMark } from './detail-reader';
export type {
  MentionedPerson,
  RequestAttachmentView,
  RequestText,
  TextVersion,
} from './detail-texts';
export { MAX_EARLIER_CHUNKS } from './detail-thread';
export type { RequestEntryView } from './detail-thread';
export { editReply, editRequestDescription } from './edits';
export { default as addNote } from './notes';
export { default as raiseRequest } from './raise';
export { listRaisableFor } from './raise-for';
export type { RaisableForPerson } from './raise-for';
export { default as replyToRequest } from './reply';
export { default as changeRequestStatus } from './status';
export { default as answerSolution } from './solutions';
export { answerByLink, createAnswerLink, readAnswerLink } from './answer-links';
export type { AnswerLinkView } from './answer-links';
export { default as updateRequestDetails } from './details';
export {
  changeAssignees,
  countAssignedRequests,
  listAssignableStaff,
  unassignFrom,
} from './assignees';
export type { AssignableStaffMember } from './assignees';
export { listMentionable } from './mentions';
export {
  changeSubscribers,
  listSubscribable,
  subscribe,
  unsubscribe,
  unsubscribeFrom,
} from './subscribers';
export type { SubscribablePerson } from './subscribers';
export {
  type QueuedWebhookNews,
  readWebhookNews,
  type WebhookNews,
  type WebhookNewsEvent,
  type WebhookPerson,
} from './read-webhook-news';
export { readRequestUpdate } from './updates';
export type { QueuedRequestNews, RequestUpdate, RequestUpdateItem } from './updates';
export type { MentionablePerson } from './mentions';
export {
  addRequestType,
  archiveRequestType,
  listRequestTypes,
  moveRequestType,
  nameBuiltInRequestTypes,
  restoreRequestType,
  updateRequestType,
} from './types';
export type { RequestTypeView } from './types';
export {
  type AttachmentsOn,
  attachmentsOn,
  type AttachmentToServe,
  DAILY_UPLOAD_BYTES,
  loadAttachment,
  removeAttachment,
  type UploadedAttachment,
  uploadAttachment,
} from './attachments';
