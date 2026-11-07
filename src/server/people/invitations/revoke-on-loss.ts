/**
 * @file Revoking open invitations when people lose access: the invitations and
 * invite links someone sent once they may no longer manage the company or
 * the staff, and the invitations addressed to someone removed.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction, DatabaseTransaction } from '@/db';
import { invitation, inviteLink, membership, user } from '@/db/schema';
import { getPermissions } from '@/lib/authz/permissions';
import { type CompanyRole } from '@/lib/authz/roles';

import { invitationLockKey, takeInvitationLock } from './locks';
import { sameTarget, auditTarget } from './rules';
import { managePermission } from '../../access';
import { recordEvent } from '../../audit';
import type { ServiceContext } from '../../context';

/**
 * Revokes the open invitations and unused invite links someone created for
 * staff or companies they can no longer manage, so they keep no way in
 * after losing their rights (e.g. a former Admin's staff Admin link). Call it
 * in the same transaction as the change: after a role change or removal, or
 * with `all` before deactivating or deleting the account.
 *
 * Links come first, then invitations, each read in a statement of its own:
 * claiming a link marks it used and creates an invitation in one
 * transaction, locking the link first. The link update only touches links
 * that are still unused once it holds them (it waits for a claim under way,
 * then skips the link it used), and the invitations are read after it, so
 * they include the invitation of a claim that committed meanwhile. A claim
 * that comes after the link update finds the link revoked. Either way no
 * invitation from one of their links stays open.
 *
 * @param ctx - Service context (for the audit log).
 * @param tx - Transaction.
 * @param userId - Who created them.
 * @param options - Options.
 * @param options.all - Revoke everything they created, whatever their rights.
 * @returns How many invitations and links were revoked.
 */
export async function revokeInvitesWithoutManager(
  ctx: ServiceContext,
  tx: DatabaseOrTransaction,
  userId: string,
  { all = false }: { all?: boolean } = {},
): Promise<number> {
  // One query at a time: a transaction runs on one connection, which can't run queries in parallel.
  const [found] = await tx
    .select({ platformRole: user.platformRole })
    .from(user)
    .where(eq(user.id, userId));
  const memberships = await tx
    .select({ companyId: membership.companyId, role: membership.role })
    .from(membership)
    .where(eq(membership.userId, userId));
  const platformRole = found?.platformRole ?? null;
  const roles = new Map<string, CompanyRole>(memberships.map((row) => [row.companyId, row.role]));
  /**
   * Whether the user may still manage people of a target.
   *
   * @param companyId - The company, or `null` for staff.
   * @returns Whether they may.
   */
  const mayManage = (companyId: string | null): boolean => {
    if (all) {
      return false;
    }
    const permission = managePermission(companyId);
    if (companyId === null) {
      return getPermissions({ platformRole, companyRole: null, company: null }).has(permission);
    }
    return getPermissions({
      platformRole,
      companyRole: roles.get(companyId) ?? null,
      company: { deactivated: false },
    }).has(permission);
  };

  // Links before invitations: claiming a link locks them in that order too, so the two can't
  // deadlock (see `createInvitationRecord`).
  const openLinks = await tx
    .select({ id: inviteLink.id, companyId: inviteLink.companyId })
    .from(inviteLink)
    .where(
      and(
        eq(inviteLink.createdBy, userId),
        isNull(inviteLink.usedAt),
        isNull(inviteLink.revokedAt),
      ),
    );
  const linkIds = openLinks.filter((row) => !mayManage(row.companyId)).map((row) => row.id);
  // Checked again once each link is locked: a claim that used it meanwhile keeps it (its
  // invitation is revoked below instead).
  const revokedLinks =
    linkIds.length > 0
      ? await tx
          .update(inviteLink)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              inArray(inviteLink.id, linkIds),
              isNull(inviteLink.usedAt),
              isNull(inviteLink.revokedAt),
            ),
          )
          .returning({ id: inviteLink.id })
      : [];
  // A new statement, after the link update: it sees the invitations of claims that committed
  // while that update waited for them.
  const openInvitations = await tx
    .select({ id: invitation.id, companyId: invitation.companyId })
    .from(invitation)
    .where(
      and(
        eq(invitation.invitedBy, userId),
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
      ),
    );
  const invitationIds = openInvitations
    .filter((row) => !mayManage(row.companyId))
    .map((row) => row.id);
  const revokedInvitations =
    invitationIds.length > 0
      ? await tx
          .update(invitation)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              inArray(invitation.id, invitationIds),
              isNull(invitation.acceptedAt),
              isNull(invitation.revokedAt),
            ),
          )
          .returning({ id: invitation.id })
      : [];
  const total = revokedInvitations.length + revokedLinks.length;
  if (total > 0) {
    await recordEvent(
      ctx,
      {
        action: 'invitation_revoked',
        targetUserId: userId,
        details: {
          automatic: true,
          reason: all ? 'account_closed' : 'rights_lost',
          invitations: revokedInvitations.length,
          links: revokedLinks.length,
        },
      },
      tx,
    );
  }
  return total;
}

/** Whose invitations to revoke: one company's or the staff's (`companyId: null`), or all of them. */
export type InvitationsToRevoke = { companyId: string | null } | 'all';

/**
 * Revokes the open invitations addressed to someone (not those they sent:
 * see {@link revokeInvitesWithoutManager}), so a person removed from a company
 * or the staff, or whose account is deleted, can't come back through an
 * invitation that was still open, possibly with a higher role than they had
 * (one sent before they joined some other way, such as being added directly
 * or joining with an invite link while signed in). Call it in the same
 * transaction as the removal or deletion, after its user and membership locks
 * and after `revokeInvitesWithoutManager` (invite links come before the
 * per-address locks in the lock order; see "Lock order" in
 * `docs/security-measures.md`).
 *
 * It takes the per-address lock ({@link lockInvitationsOf}) of each target
 * first, in key order for `all`, so it takes turns with an invitation sent,
 * resent or revoked for the address at that moment, and then revokes in a new
 * statement, which sees what those committed. An invitation still being
 * created for a target it doesn't lock (in `all`, a target the address had no
 * open invitation for when it looked) commits afterwards and stays open, as
 * if it had been sent just after the deletion, which anyone allowed to invite
 * may do anyway.
 *
 * @param ctx - Service context (for the audit log).
 * @param tx - The removal's or deletion's transaction.
 * @param email - The person's email address.
 * @param target - `{ companyId }` for one company, `{ companyId: null }` for the staff, or `'all'`
 *   for every company and the staff (when the account is deleted).
 * @returns How many invitations were revoked; when any were, an `invitation_revoked` event
 *   records how many, with the reason (`member_removed` or `account_closed`).
 */
export async function revokeInvitationsTo(
  ctx: ServiceContext,
  tx: DatabaseTransaction,
  email: string,
  target: InvitationsToRevoke,
): Promise<number> {
  // Invitations store addresses in lower case.
  const address = email.toLowerCase();
  const open = and(
    eq(invitation.email, address),
    isNull(invitation.acceptedAt),
    isNull(invitation.revokedAt),
  );
  const companyId = target === 'all' ? null : target.companyId;
  let keys = [invitationLockKey(companyId, address)];
  if (target === 'all') {
    const targets = await tx
      .selectDistinct({ companyId: invitation.companyId })
      .from(invitation)
      .where(open);
    keys = [...new Set(targets.map((row) => invitationLockKey(row.companyId, address)))].sort();
  }
  // One at a time, in key order, so two transactions taking several of them can't deadlock.
  await keys.reduce(async (previous, key) => {
    await previous;
    await takeInvitationLock(tx, key);
  }, Promise.resolve());

  // A new statement, once the locks are held.
  const revoked = await tx
    .update(invitation)
    .set({ revokedAt: sql`now()` })
    .where(target === 'all' ? open : and(open, sameTarget(invitation.companyId, companyId)))
    .returning({ id: invitation.id });
  if (revoked.length > 0) {
    const details = {
      automatic: true,
      reason: target === 'all' ? 'account_closed' : 'member_removed',
      email: address,
      invitations: revoked.length,
    };
    await recordEvent(
      ctx,
      {
        action: 'invitation_revoked',
        ...(target === 'all' ? { companyId: null, details } : auditTarget(companyId, details)),
      },
      tx,
    );
  }
  return revoked.length;
}
