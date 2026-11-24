/**
 * @file What a staff Admin does to someone else's account: reset two-step
 * verification (which also disconnects GitHub and Google accounts), sign out
 * everywhere, deactivate, reactivate and delete.
 *
 * Every change is recorded in the audit log, emails the user, and refuses
 * anything that would leave a company or the staff without an Admin who can
 * sign in (`assertNotSoleAdmin`). Resetting two-step verification, and
 * reactivating an account that kept a staff role or a company's Admin role,
 * need the Admin's recent confirmation with their own second step.
 */
import { and, eq, inArray } from 'drizzle-orm';

import type { DatabaseOrTransaction, DatabaseTransaction } from '@/db';
import { account, passkey, twoFactor, user } from '@/db/schema';
import { reactivationGrants } from '@/lib/authz/guards';
import { needsRecentConfirmation } from '@/lib/authz/mfa';
import { PLATFORM_ADMIN_ROLE } from '@/lib/authz/roles';
import { normalizeEmail } from '@/lib/email-address';
import { OAUTH_PROVIDERS } from '@/lib/sign-in/oauth-providers';

import {
  assertConfirmedForGrant,
  assertNotSignedInAs,
  assertPermission,
  getGlobalPermissions,
} from '../../access';
import type { Actor } from '../../actor';
import { recordEvent } from '../../audit';
import { queueSecurityNotice, sendAccountDeletedNotice } from '../../auth/security-notices';
import { endSessionsOf } from '../../auth/sessions';
import { withSignInChangeLock } from '../../auth/sign-in-change-lock';
import type { ServiceContext } from '../../context';
import { notFoundError, ServiceError, parseId } from '../../errors';
import { unassignFrom, unsubscribeFrom } from '../../requests';
import { revokeInvitationsTo, revokeInvitesWithoutManager } from '../invitations';
import notifyStaffAdminAdded from '../staff-admin-notice';
import loadKeptRoles from './kept-roles';
import { assertNotSoleAdmin } from './sole-admin';

/**
 * Reads the ID of the user an Admin action is about, refusing actions on
 * yourself (use your Security page instead, with its own checks).
 *
 * @param actor - The acting user.
 * @param userId - The target (unvalidated input is fine).
 * @returns The target's ID.
 * @throws {ServiceError} `not_found` for anything that isn't an ID, `invalid` for yourself.
 */
function targetIdOf(actor: Actor, userId: string): string {
  const id = parseId(userId);
  if (id === actor.id) {
    throw new ServiceError('invalid', 'errors.users.ownAccount');
  }
  return id;
}

/**
 * Loads the user an Admin action is about, refusing actions on yourself
 * ({@link targetIdOf}). Only for account actions: company memberships and the
 * staff role don't use it.
 *
 * @param db - Database client or transaction.
 * @param actor - The acting user.
 * @param userId - The target (unvalidated input is fine).
 * @param options - How to read.
 * @param options.lock - Lock the target's row (`FOR UPDATE`, inside a transaction). A read that
 *   waited for the lock sees the row as the change it waited for left it.
 * @returns The target's ID, email and deactivation.
 * @throws {ServiceError} `not_found` or `invalid` for yourself.
 */
async function loadTarget(
  db: DatabaseOrTransaction,
  actor: Actor,
  userId: string,
  options: { lock?: boolean } = {},
) {
  const id = targetIdOf(actor, userId);
  const query = db
    .select({ id: user.id, email: user.email, name: user.name, deactivatedAt: user.deactivatedAt })
    .from(user)
    .where(eq(user.id, id));
  const [target] = await (options.lock ? query.for('update') : query);
  if (!target) {
    throw notFoundError();
  }
  return target;
}

/**
 * Turns off a user's two-step verification (for a lost phone), optionally
 * removing their passkeys too, and disconnects their GitHub and Google
 * accounts, confirmed or not: one connected by someone who once verified the
 * user's address at the provider may be the account's only second step, which
 * nothing else could remove (see "Automatic linking" in
 * `docs/authentication.md`). It also signs them out everywhere (a lost phone
 * may still be signed in) and forgets their trusted devices. Their next
 * sign-in is with their password, a passkey they kept or an email link, and
 * if their role requires MFA they're asked to set it up again. The audit
 * event names the providers whose accounts were disconnected, and the user
 * gets a security email.
 *
 * In this order:
 *
 * 1. The Admin needs `users:manage`, and a confirmation with their own second
 *    step from the last 15 minutes (`needsRecentConfirmation`), as for
 *    changing how they sign in themselves.
 * 2. Not on yourself (use your Security page).
 * 3. The reset holds the user's sign-in change lock (`withSignInChangeLock`),
 *    so it can't cross a change they're making at that moment, such as
 *    connecting a provider account.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:manage`.
 * @param userId - The user.
 * @param options - What to reset.
 * @param options.removePasskeys - Also remove all their passkeys.
 * @throws {ServiceError} `forbidden` without `users:manage` or a recent confirmation
 *   (`errors.signIn.mfaVerificationRequired`), `invalid` on yourself, `not_found` for unknown users,
 *   `conflict` while another change to how the user signs in is being made.
 */
export async function resetUserMfa(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
  { removePasskeys = false }: { removePasskeys?: boolean } = {},
): Promise<void> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'users:manage');
  if (needsRecentConfirmation(actor)) {
    throw new ServiceError('forbidden', 'errors.signIn.mfaVerificationRequired');
  }
  const targetId = targetIdOf(actor, userId);
  await withSignInChangeLock(ctx, targetId, () =>
    ctx.db.transaction(async (tx) => {
      const target = await loadTarget(tx, actor, targetId);
      await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, target.id));
      await tx.delete(twoFactor).where(eq(twoFactor.userId, target.id));
      if (removePasskeys) {
        await tx.delete(passkey).where(eq(passkey.userId, target.id));
      }
      const disconnected = await tx
        .delete(account)
        .where(
          and(eq(account.userId, target.id), inArray(account.providerId, [...OAUTH_PROVIDERS])),
        )
        .returning({ providerId: account.providerId });
      await endSessionsOf(tx, target.id);
      await recordEvent(
        ctx,
        {
          action: 'mfa_reset',
          actorUserId: actor.id,
          targetUserId: target.id,
          // Which providers, never which accounts (their names are personal data).
          details: {
            removePasskeys,
            disconnectedProviders: [...new Set(disconnected.map((row) => row.providerId))].sort(),
          },
        },
        tx,
      );
    }),
  );
  await queueSecurityNotice(ctx.db, targetId, 'mfa_reset');
}

/**
 * Signs a user out on every device, and forgets their trusted devices.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:manage`.
 * @param userId - The user.
 */
export async function signOutUserEverywhere(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
): Promise<void> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'users:manage');
  const { targetId } = await ctx.db.transaction(async (tx) => {
    const target = await loadTarget(tx, actor, userId);
    // Trusted devices too: a stolen device that was trusted mustn't skip the code step at its next
    // sign-in.
    await endSessionsOf(tx, target.id);
    await recordEvent(
      ctx,
      {
        action: 'sessions_revoked',
        actorUserId: actor.id,
        targetUserId: target.id,
        details: { byAdmin: true },
      },
      tx,
    );
    return { targetId: target.id };
  });
  await queueSecurityNotice(ctx.db, targetId, 'signed_out_everywhere');
}

/**
 * Deactivates an account: signs it out everywhere and forgets its trusted
 * devices (so a stolen browser that was trusted can't skip the code step
 * after a reactivation), revokes the invitations and invite links it sent,
 * takes it off the requests it's assigned to (`unassignFrom`), and refuses
 * new sign-ins until an Admin reactivates it. Call it after the locking last-Admin check
 * (`assertNotSoleAdmin`), which has locked the account's row.
 *
 * @param ctx - Service context (for the audit log).
 * @param db - Transaction.
 * @param userId - The user.
 */
export async function deactivate(
  ctx: ServiceContext,
  db: DatabaseTransaction,
  userId: string,
): Promise<void> {
  await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, userId));
  await endSessionsOf(db, userId);
  await revokeInvitesWithoutManager(ctx, db, userId, { all: true });
  // A deactivated account works on no requests: off the ones it's on (requests come last).
  await unassignFrom(db, userId);
  // And it follows none.
  await unsubscribeFrom(db, userId);
}

/**
 * The refusal for deactivating an account that's deactivated already.
 *
 * @returns The error (`conflict`).
 */
function alreadyDeactivatedError(): ServiceError {
  return new ServiceError('conflict', 'errors.users.alreadyDeactivated');
}

/**
 * Deactivates someone else's account.
 *
 * Whether the account is deactivated already is checked twice: as the
 * request finds it, and again once its row is locked (`assertNotSoleAdmin`
 * locks it). Of two deactivations at the same moment the second waits for
 * that lock and then finds the first one's, so the audit log records the
 * deactivation once and the user gets one email about it.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:manage`.
 * @param userId - The user.
 * @throws {ServiceError} `conflict` when already deactivated or the last Admin of a company.
 */
export async function deactivateUser(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
): Promise<void> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'users:manage');
  const { targetId } = await ctx.db.transaction(async (tx) => {
    const target = await loadTarget(tx, actor, userId);
    if (target.deactivatedAt) {
      throw alreadyDeactivatedError();
    }
    await assertNotSoleAdmin(tx, target.id, 'user');
    // A new statement, with the row locked: it sees a deactivation that committed meanwhile.
    const locked = await loadTarget(tx, actor, target.id);
    if (locked.deactivatedAt) {
      throw alreadyDeactivatedError();
    }
    await deactivate(ctx, tx, target.id);
    await recordEvent(
      ctx,
      { action: 'account_deactivated', actorUserId: actor.id, targetUserId: target.id },
      tx,
    );
    return { targetId: target.id };
  });
  await queueSecurityNotice(ctx.db, targetId, 'account_deactivated');
}

/**
 * Reactivates a deactivated account, so it can sign in again.
 *
 * Deactivating kept the account's staff role and memberships, so this gives
 * them back: a lasting way in, like giving those roles anew (decision 0004).
 * When it kept a staff role or a company's Admin role, the Admin needs a
 * confirmation with their second step from the last 15 minutes
 * (`assertConfirmedForGrant` for each of `reactivationGrants`), and a
 * reactivated staff Admin is emailed to the other staff Admins
 * (`notifyStaffAdminAdded`), as a new one is. The account has no sessions
 * to end: deactivating ended them, and none start while it's deactivated.
 *
 * The account's row is locked as it's read, before whether it's deactivated
 * is checked and its roles are read. Of two reactivations at the same moment
 * the second waits for that lock and then finds the account active, so the
 * audit log records the reactivation once and the user gets one email about
 * it.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:manage`.
 * @param userId - The user.
 * @throws {ServiceError} `conflict` when the account is active, `confirmation_required`
 *   (`errors.grantConfirmationRequired`) when it kept a staff role or a company's Admin role and
 *   the actor hasn't confirmed it's them in the last 15 minutes.
 */
export async function reactivateUser(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
): Promise<void> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'users:manage');
  const { targetId, staffAdmin } = await ctx.db.transaction(async (tx) => {
    const target = await loadTarget(tx, actor, userId, { lock: true });
    if (!target.deactivatedAt) {
      throw new ServiceError('conflict', 'errors.users.alreadyActive');
    }
    const kept = await loadKeptRoles(tx, target.id);
    reactivationGrants(kept).forEach((grant) => assertConfirmedForGrant(actor, grant));
    await tx.update(user).set({ deactivatedAt: null }).where(eq(user.id, target.id));
    await recordEvent(
      ctx,
      { action: 'account_reactivated', actorUserId: actor.id, targetUserId: target.id },
      tx,
    );
    return { targetId: target.id, staffAdmin: kept.staffRole === PLATFORM_ADMIN_ROLE };
  });
  await queueSecurityNotice(ctx.db, targetId, 'account_reactivated');
  if (staffAdmin) {
    await notifyStaffAdminAdded(ctx, {
      newAdminId: targetId,
      how: 'reactivation',
      byUserId: actor.id,
    });
  }
}

/**
 * Deletes a user account permanently, with their memberships, sign-in
 * methods and sessions. Open invitations and links they sent are revoked
 * first (used ones stay in the history, without an inviter), and so are the
 * open invitations addressed to them, to any company or the staff
 * (`revokeInvitationsTo`): otherwise one could create a new account for the
 * address and join with it. Once the deletion has committed, the address the
 * account had (read in the transaction, with its row locked) gets an
 * `account_deleted` security email, without the Admin's device or IP address.
 *
 * The last-Admin check locks the user's row (`FOR UPDATE`) before the
 * revoke, and the row stays locked until the account is gone: an invitation
 * or invite link they create at that moment waits for it (its insert locks
 * the row as its creator), so it either committed before and is revoked, or
 * fails once the account is gone. A link of theirs claimed at that moment
 * leaves no open invitation either (see `revokeInvitesWithoutManager`). The
 * invitations addressed to them are revoked last, under their per-address
 * locks (after invite links, as the lock order wants).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:delete`.
 * @param userId - The user.
 * @param confirmEmail - The user's email address, typed to confirm.
 * @throws {ServiceError} `invalid` when the email doesn't match, `conflict`
 *   when they're the last Admin of a company.
 */
export async function deleteUser(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
  confirmEmail: string,
): Promise<void> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'users:delete');
  const { email, locale, timeZone } = await ctx.db.transaction(async (tx) => {
    const target = await loadTarget(tx, actor, userId);
    if (normalizeEmail(confirmEmail) !== target.email.toLowerCase()) {
      throw new ServiceError('invalid', 'errors.users.confirmEmail');
    }
    // Locks their row first, so nothing they create meanwhile escapes the revoke below.
    await assertNotSoleAdmin(tx, target.id, 'user');
    // Their address as it is now that the row is locked (a new statement): it can't change
    // before the deletion commits, and the security email goes to it, in their language and zone.
    const [locked] = await tx
      .select({ email: user.email, locale: user.locale, timeZone: user.timeZone })
      .from(user)
      .where(eq(user.id, target.id));
    if (!locked) {
      throw notFoundError();
    }
    // Their invitations would otherwise keep working without an inviter.
    await revokeInvitesWithoutManager(ctx, tx, target.id, { all: true });
    // And those addressed to them would let a new account for the address join.
    await revokeInvitationsTo(ctx, tx, locked.email, 'all');
    // Off the requests they're on, before the row goes, so each request's history says so.
    await unassignFrom(tx, target.id);
    await recordEvent(
      ctx,
      {
        action: 'account_deleted',
        actorUserId: actor.id,
        targetUserId: null,
        details: { email: locked.email, name: target.name },
      },
      tx,
    );
    await tx.delete(user).where(eq(user.id, target.id));
    return { email: locked.email, locale: locked.locale, timeZone: locked.timeZone };
  });
  // Only once the deletion has committed: a refused one sends nothing. The account is gone, so its
  // language and zone come along.
  await sendAccountDeletedNotice(ctx, email, locale, timeZone);
}
