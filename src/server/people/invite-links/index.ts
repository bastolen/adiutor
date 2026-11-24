/**
 * @file Single-use invite links to a company or to the staff (no
 * company).
 *
 * An admin creates a link for a role (`manage.ts`). The first person to open
 * it enters their email address, which uses up the link and turns it into a
 * normal email invitation for that address (`claim.ts`). That proves they
 * own the address and reuses the one acceptance flow. A signed-in user can
 * instead join directly with their own account (`join.ts`). What a link that
 * can still be used is, and how it's used up, they share (`usable.ts`).
 *
 * Whatever email is entered, the response is the same "check your inbox",
 * and the link is used up: an open invitation someone sent to that address
 * is kept rather than replaced. Each claim counts against the invitation
 * limits of the link's creator and its company, like an invitation they send.
 * A claim whose email can't be sent is undone, so the link can be used again.
 *
 * This is the module's public API: the flows live in the files next to it,
 * and nothing outside this folder imports them directly.
 */
export { createInviteLink, listInviteLinks, revokeInviteLink } from './manage';
export type { InviteLinkStatus, InviteLinkSummary } from './manage';
export { getInviteLinkPreview } from './usable';
export { claimInviteLink } from './claim';
export { joinWithInviteLink } from './join';
