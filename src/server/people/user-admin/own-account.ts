/**
 * @file Deactivating your own account, from the Security page.
 */
import { verifyPassword } from 'better-auth/crypto';
import { and, eq, isNotNull } from 'drizzle-orm';

import { account } from '@/db/schema';
import { needsFreshSignIn, needsRecentConfirmation } from '@/lib/authz/mfa';

import { assertNotSignedInAs } from '../../access';
import type { Actor } from '../../actor';
import { recordEvent } from '../../audit';
import { checkCurrentPassword } from '../../auth/current-password';
import { queueSecurityNotice } from '../../auth/security-notices';
import type { ServiceContext } from '../../context';
import { ServiceError } from '../../errors';
import { deactivate } from './admin-actions';
import { assertNotSoleAdmin } from './sole-admin';

/**
 * Deactivates the signed-in user's own account. Only an Admin can
 * reactivate it. In this order:
 *
 * 1. An account with a second step needs a confirmation with it from the
 *    last 15 minutes (`needsRecentConfirmation`), as for changing how it
 *    signs in.
 * 2. Someone who's the last Admin of the staff or an active company is
 *    refused before their password is checked, so the refusal is the same
 *    with a right or a wrong one: a session can't use it to test passwords.
 * 3. With a password, it must be typed (`checkCurrentPassword`: wrong ones
 *    are limited per user and recorded). Without a password or a second
 *    step, the session must have signed in within the last hour
 *    (`needsFreshSignIn`), so an old (stolen) session can't do it alone.
 * 4. The change's transaction repeats the last-Admin check with locks, then
 *    deactivates the account.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param password - Their current password, required when they have one.
 * @throws {ServiceError} `forbidden` without a recent confirmation
 *   (`errors.signIn.mfaVerificationRequired`) or a fresh sign-in (`errors.signIn.sessionNotFresh`), `conflict` when they're the last Admin
 *   of the staff or a company, `invalid` for a wrong password, `rate_limited` after too many.
 */
export async function deactivateOwnAccount(
  ctx: ServiceContext,
  actor: Actor,
  password: string,
): Promise<void> {
  assertNotSignedInAs(actor);
  if (needsRecentConfirmation(actor)) {
    throw new ServiceError('forbidden', 'errors.signIn.mfaVerificationRequired');
  }
  // Without locks: it only answers early, and the transaction below checks again with them.
  await assertNotSoleAdmin(ctx.db, actor.id, 'self', { lock: false });
  const [credential] = await ctx.db
    .select({ password: account.password })
    .from(account)
    .where(
      and(
        eq(account.userId, actor.id),
        eq(account.providerId, 'credential'),
        isNotNull(account.password),
      ),
    );
  const hash = credential?.password;
  if (hash) {
    // Outside the transaction, so a wrong password's attempt and audit event are kept.
    await checkCurrentPassword(ctx, actor, 'deactivate', () => verifyPassword({ hash, password }));
  } else if (needsFreshSignIn(actor)) {
    // No password and no second step (with one, the confirmation above was needed).
    throw new ServiceError('forbidden', 'errors.signIn.sessionNotFresh');
  }
  const auditEventId = await ctx.db.transaction(async (tx) => {
    await assertNotSoleAdmin(tx, actor.id, 'self');
    await deactivate(ctx, tx, actor.id);
    return recordEvent(
      ctx,
      {
        action: 'account_deactivated',
        actorUserId: actor.id,
        targetUserId: actor.id,
        details: { self: true },
      },
      tx,
    );
  });
  // Their own change, so the email may say from which device (its audit event's).
  await queueSecurityNotice(ctx.db, actor.id, 'account_deactivated', { auditEventId });
}
