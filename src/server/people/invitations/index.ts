/**
 * @file Email invitations to a company or to the staff (no company):
 * sending, resending, revoking and accepting, and revoking the open
 * invitations of people who lose access: those they sent
 * (`revokeInvitesWithoutManager`) and those addressed to them
 * (`revokeInvitationsTo`).
 *
 * Privacy rule: whether an email address already has an account (or is
 * already a member) may only be shown to staff. Company
 * users always get the same "invitation sent" result; when the person is
 * already a member, they receive an "already a member" email instead, so the
 * message stays true without revealing anything.
 *
 * This is the module's public API: the flows live in the files next to it,
 * and nothing outside this folder imports them directly.
 */
export {
  sameTarget,
  joinedPath,
  visibleStatus,
  assertCanManage,
  assertInvitable,
  auditTarget,
} from './rules';
export type { InviteDestination } from './rules';
export { createInvitationRecord, createSentInvitation } from './record';
export type { LinkClaimStatus, CreatedInvitation } from './record';
export { inviteByEmail, inviteManyByEmail } from './send';
export type { BulkInviteResult } from './send';
export { listPendingInvitations, resendInvitation, revokeInvitation } from './manage';
export type { PendingInvitation } from './manage';
export {
  inviteLinksNotAllowedError,
  getInvitationPreview,
  joinTarget,
  acceptInvitation,
  acceptInvitationWithNewAccount,
} from './accept';
export type {
  InvitationPreview,
  InvitationDetails,
  AcceptResult,
  CreateAccountResult,
} from './accept';
export { revokeInvitesWithoutManager, revokeInvitationsTo } from './revoke-on-loss';
export type { InvitationsToRevoke } from './revoke-on-loss';
