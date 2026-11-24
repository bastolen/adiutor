/**
 * @file Joining with an invite link as the signed-in user: the link is used
 * up and the user joins its company (or the staff) with their own account,
 * without an email invitation in between.
 */
import { eq } from 'drizzle-orm';

import { session } from '@/db/schema';
import { mayUseInviteLinks } from '@/lib/authz/permissions';
import type { PlatformRole } from '@/lib/authz/roles';

import { assertNotSignedInAs } from '../../access';
import type { Actor } from '../../actor';
import type { ServiceContext } from '../../context';
import { inviteLinksNotAllowedError, joinTarget } from '../invitations';
import notifyStaffAdminAdded from '../staff-admin-notice';
import { useLink } from './usable';

/**
 * Uses a link to join directly as the signed-in user. Joining a company
 * you're already in keeps your current role, and so does joining the staff
 * when you're already on it. `companyId` is `null` after joining the staff.
 *
 * @param ctx - Service context.
 * @param token - The token from the link.
 * @param signedIn - The signed-in user.
 * @param signedIn.id - Their user ID.
 * @param signedIn.email - Their email address.
 * @param signedIn.platformRole - Their staff role; Finance and Support may not use invite links.
 * @param signedIn.sessionId - The session they join with. Unlike an emailed invitation, a link
 *   proves no inbox, so when the new role requires MFA this session ends too unless it was
 *   confirmed with a strong factor (`withMfaPromotion`).
 * @param signedIn.signedInAs - The staff member signed in as them, if any: they join nothing.
 * @returns What was joined (and whether that ended the session it was joined with), or
 *   `invalid` if the link wasn't usable.
 * @throws {ServiceError} `forbidden` for Finance and Support (see `mayUseInviteLinks`);
 *   `signed_in_as` while a staff member is signed in as them, before the link is used up.
 */
export async function joinWithInviteLink(
  ctx: ServiceContext,
  token: string,
  signedIn: {
    id: string;
    email: string;
    platformRole: PlatformRole | null;
    sessionId?: string | null;
    signedInAs?: Actor['signedInAs'];
  },
): Promise<
  { status: 'joined'; companyId: string | null; signedOut: boolean } | { status: 'invalid' }
> {
  assertNotSignedInAs(signedIn);
  // Checked before the link is used up, so it still works for whoever it was meant for.
  if (!mayUseInviteLinks(signedIn.platformRole)) {
    throw inviteLinksNotAllowedError();
  }
  const { result, newStaffAdmin } = await ctx.db.transaction(async (tx) => {
    const used = await useLink(tx, token, signedIn.email.toLowerCase());
    if (!used) {
      return { result: { status: 'invalid' as const }, newStaffAdmin: null };
    }
    const becameStaffAdmin = await joinTarget(ctx, tx, {
      companyId: used.companyId,
      role: used.role,
      userId: signedIn.id,
      details: { via: 'invite_link' },
    });
    const [still] = signedIn.sessionId
      ? await tx.select({ id: session.id }).from(session).where(eq(session.id, signedIn.sessionId))
      : [];
    return {
      result: {
        status: 'joined' as const,
        companyId: used.companyId,
        signedOut: Boolean(signedIn.sessionId) && !still,
      },
      newStaffAdmin: becameStaffAdmin
        ? { newAdminId: signedIn.id, how: 'invitation' as const, byUserId: used.createdBy }
        : null,
    };
  });
  // Once committed: the other staff Admins hear about a new one.
  if (newStaffAdmin) {
    await notifyStaffAdminAdded(ctx, newStaffAdmin);
  }
  return result;
}
