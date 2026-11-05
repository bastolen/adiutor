/**
 * @file What happened to an invitation request, and the message shown after
 * sending one. Pure and client-safe; the invitations service returns these
 * statuses.
 */

/**
 * What happened to an invitation request. Only staff see the detailed
 * status; everyone else always sees `sent` (`visibleStatus` in
 * `src/server/people/invitations/`).
 */
export type InviteStatus = 'sent' | 'sent_existing_user' | 'already_member';

/**
 * The confirmation shown after inviting someone. Company users only
 * ever receive the `sent` status, so their message is the same for every
 * address; staff see the detail.
 *
 * @param email - The invited address.
 * @param status - The status the user may see.
 * @returns The message.
 */
export default function inviteStatusMessage(email: string, status: InviteStatus): string {
  switch (status) {
    case 'sent_existing_user':
      return `Invitation sent to ${email}. They already have an Adiutor account.`;
    case 'already_member':
      return `${email} is already a member. We've emailed them to let them know.`;
    default:
      return `Invitation sent to ${email}.`;
  }
}
