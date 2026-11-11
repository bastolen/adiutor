/**
 * @file Ends the sessions that don't meet the MFA a user's role newly
 * requires. When a change makes someone a company Admin, a staff Manager or
 * a staff Admin (or reactivates a company they're the Admin of), their
 * sessions that weren't confirmed with MFA that counts for the new role
 * (`isSessionMfaVerified`, so an email code doesn't) end. A session from
 * before, possibly stolen, could otherwise add its own passkey without
 * confirming: an account without a second step that counts only needs a
 * sign-in from the last hour for that (`auth-guards/`). The user signs in
 * again and sets up MFA first.
 */
import { inArray } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { session } from '@/db/schema';
import { isSessionMfaVerified, requiresMfa, sessionMfaOf } from '@/lib/authz/mfa';

import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { loadMfaRoles } from './mfa-state';

/** Options for {@link withMfaPromotion}. */
export interface MfaPromotionOptions {
  /**
   * A session to keep even so: the one a user accepts an emailed invitation
   * with themselves, having just proved its inbox (they're sent to set up
   * MFA). Never for an invite link, which proves no inbox.
   */
  keepSessionId?: string | null;
  /** The company the change is about, if any, recorded with the sign-out. */
  companyId?: string | null;
}

/**
 * Runs a change that may make users' roles require MFA, then ends their
 * sessions that don't meet it, recording that in the audit log. Use it in
 * the change's transaction, around the change itself, for every user whose
 * role it can affect. Users whose role required MFA already are left alone.
 *
 * @param ctx - Service context (for the audit log).
 * @param tx - The change's transaction.
 * @param userIds - The users the change can affect.
 * @param change - The change.
 * @param options - Options.
 * @returns What the change returned.
 */
export async function withMfaPromotion<T>(
  ctx: Pick<ServiceContext, 'db' | 'requestInfo'>,
  tx: DatabaseOrTransaction,
  userIds: readonly string[],
  change: () => Promise<T>,
  options: MfaPromotionOptions = {},
): Promise<T> {
  const before = await loadMfaRoles(tx, userIds);
  const result = await change();
  const after = await loadMfaRoles(tx, userIds);
  const promoted = [...after].filter(
    ([userId, role]) => requiresMfa(role) && !requiresMfa(before.get(userId) ?? null),
  );
  if (promoted.length === 0) {
    return result;
  }
  // One query at a time: the transaction's one connection can't run them in parallel.
  const roles = new Map(promoted);
  const sessions = await tx
    .select({
      id: session.id,
      userId: session.userId,
      mfaVerified: session.mfaVerified,
      mfaMethod: session.mfaMethod,
    })
    .from(session)
    .where(inArray(session.userId, [...roles.keys()]));
  const weaker = sessions.filter(
    (found) =>
      found.id !== options.keepSessionId &&
      !isSessionMfaVerified(sessionMfaOf(found), roles.get(found.userId) ?? null),
  );
  if (weaker.length === 0) {
    return result;
  }
  await tx.delete(session).where(
    inArray(
      session.id,
      weaker.map((found) => found.id),
    ),
  );
  const counts = new Map<string, number>();
  weaker.forEach((found) => counts.set(found.userId, (counts.get(found.userId) ?? 0) + 1));
  // Caused by the change (recorded with its actor), on each user's own account, in turn.
  await [...counts].reduce(async (previous, [userId, count]) => {
    await previous;
    await recordEvent(
      ctx,
      {
        action: 'sessions_revoked',
        targetUserId: userId,
        companyId: options.companyId ?? null,
        details: { mfaRequired: true, count },
      },
      tx,
    );
  }, Promise.resolve());
  return result;
}
