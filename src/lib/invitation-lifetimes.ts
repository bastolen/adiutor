/**
 * @file How long invitations and invite links stay valid. Pure and
 * client-safe, so the services that enforce these and the pages and forms
 * that describe them share one source. Pages word a number of days with an
 * ICU plural in their own messages.
 */

/** How many days an invitation link stays valid. */
export const INVITATION_VALID_DAYS = 7;

/** How long a new invite link can stay valid, in days. */
export const INVITE_LINK_VALIDITY_DAYS = [1, 7, 30] as const;

/** A validity an invite link can be created with, in days. */
export type InviteLinkValidity = (typeof INVITE_LINK_VALIDITY_DAYS)[number];

/**
 * Checks whether a number of days is one an invite link can be created with.
 *
 * @param days - The requested validity.
 * @returns Whether it's allowed.
 */
export function isInviteLinkValidity(days: number): days is InviteLinkValidity {
  return (INVITE_LINK_VALIDITY_DAYS as readonly number[]).includes(days);
}
