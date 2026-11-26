/**
 * @file Requests: what companies raise with the staff and work through with
 * them. This is the module's public API: the values a request can have, the
 * rules of working on one, how its activity is read, the board's lanes, its
 * number, its text and the files that may be attached to it. The code lives in the
 * files next to it, and nothing outside this folder imports them directly.
 *
 * Everything here is free of zod and of server code, so the database schema,
 * the services and client components can all import it. Not to be confused
 * with `src/lib/request/`, which is about HTTP requests.
 */
export {
  ACTIVE_REQUEST_STATUSES,
  ASSIGNMENT_CHANGES,
  CLOSED_REQUEST_STATUSES,
  DEFAULT_REQUEST_STATUS_FILTER,
  isAssignmentChange,
  isClosedStatus,
  isRequestPriority,
  isRequestStatus,
  isRequestStatusFilter,
  isRequestTypeKey,
  ONLY_STATUS_PARAM,
  REQUEST_ENTRY_KINDS,
  REQUEST_PARTICIPANT_ROLES,
  REQUEST_PRIORITIES,
  REQUEST_SIDES,
  REQUEST_STATUS_FILTERS,
  REQUEST_STATUSES,
  REQUEST_TEXT_FORMATS,
  REQUEST_TYPE_KEY_PATTERN,
  requestTypeKeyFromName,
  STAFF_ONLY_ENTRY_KINDS,
  statusesOfFilter,
  WRITTEN_ENTRY_KINDS,
  WRITTEN_TEXT_FORMAT,
} from './values';
export type {
  AssignmentChange,
  RequestEntryKind,
  RequestParticipantRole,
  RequestPriority,
  RequestSide,
  RequestStatus,
  RequestStatusFilter,
  RequestTextFormat,
  WrittenEntryKind,
} from './values';
export {
  isReopening,
  mayAnswerSolution,
  mayBeAssigned,
  mayEditDescription,
  mayEditNote,
  mayEditReply,
  mayChangeStatus,
  mayContribute,
  mayProposeSolution,
  mayRemoveAttachment,
  mayReplyWithStatus,
  maySetStatus,
  mayWaitWithReply,
  mayWriteNote,
  requestAudience,
  requestSide,
  SOLUTION_ANSWERS,
  statusAfterAnswer,
  statusAfterReply,
  statusChangeKind,
  statusChoices,
  subscriberScope,
} from './rules';
export type { RequestAudience, SolutionAnswer, SubscriberScope } from './rules';
export {
  ACTIVITY_GROUPS,
  ACTIVITY_ORDERS,
  activityKinds,
  DEFAULT_ACTIVITY_ORDER,
  DEFAULT_ACTIVITY_VIEW,
  effectiveActivityGroups,
  isActivityGroup,
  isActivityGroupShown,
  isActivityOrder,
  isIncludedActivityGroup,
  normalizeActivityGroups,
  offeredActivityGroups,
  withActivityGroup,
} from './activity';
export type { ActivityGroup, ActivityOrder, ActivityView } from './activity';
export {
  DEFAULT_REQUEST_PREFIX,
  formatRequestNumber,
  parseRequestNumber,
  parseRequestReference,
  REQUEST_PREFIX_PATTERN,
  requestNumberStartInSearch,
  requestPath,
} from './number';
export { ANSWER_LINK_PATH, answerLinkPath } from './answer-link';
export {
  DESCRIPTION_ANCHOR,
  ENTRY_PARAM,
  entryAnchor,
  entryIdOf,
  isEntryAnchor,
  isEntryId,
  requestPathAt,
  requestPathWithEntry,
} from './anchors';
export {
  BOARD_LANES,
  BOARD_PATH,
  boardColumnOf,
  boardColumns,
  CLOSED_LANE_LIMIT,
  COMPANY_BOARD_SEGMENT,
  GROUPED_LANES,
  laneAudience,
  MOVE_REFUSALS,
  moveRefusal,
  placeMovedCard,
} from './board';
export type { BoardColumn, BoardColumnKey, BoardLaneState, MoveRefusal } from './board';
export { cleanMultilineText, isStaffPage, linkTarget, splitLinks, textLinkTarget } from './text';
export { staffLinksAsLabels } from './staff-link-labels';
export type { TextPart } from './text';
export {
  editStoredMentions,
  isMentionKey,
  MAX_MENTIONS_PER_TEXT,
  MENTION_KEY_LENGTH,
  nameStoredMentions,
  storedMentionId,
  storedMentionMarker,
  storeWrittenMentions,
  writtenMentionKey,
  writtenMentionKeys,
  writtenMentionMarker,
} from './mentions';
export type { AttachmentCheck, AttachmentType } from './attachments';
export {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_NAME_HEADER,
  ATTACHMENT_NAME_MAX_LENGTH,
  ATTACHMENT_TYPES,
  ATTACHMENT_UPLOAD_PATH,
  attachmentTypeOf,
  cleanAttachmentName,
  MAX_ATTACHMENTS_PER_TEXT,
  UPLOADS_AT_ONCE,
} from './attachments';
