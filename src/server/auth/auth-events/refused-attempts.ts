/**
 * @file The reactions to a refused request: wrong passwords and wrong codes are
 * recorded, and the owner is told when they pause signing in.
 */
import { APIError, isAPIError } from 'better-auth/api';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { twoFactor, user } from '@/db/schema';
import { mfaMethodFromPath, TWO_FACTOR_LOCK_MINUTES } from '@/lib/authz/mfa';

import { recordEvent } from '../../audit';
import { hitRateLimit, peekRateLimit, releaseRateLimitHit } from '../../rate-limit';
import { hasPassword } from '../accounts';
import { CODE_PATHS, pendingCodeSignInOf } from '../auth-guards';
import { queueSecurityNotice } from '../security-notices';
import type { FinishedRequest } from './finished-request';
import { type AuthHookContext, auditContext, runAfterResponse, audit } from './hook-context';

/** How often a user is told that their password sign-in was paused, at most. */
const PAUSED_NOTICE_LIMIT = { limit: 1, windowSeconds: 24 * 60 * 60 };

/**
 * Tells a user that wrong passwords paused their password sign-in, at most
 * once a day (a notice that couldn't be queued doesn't count; one the mail
 * server refuses is retried by the queue), and only if
 * they have a password: for anyone else nothing was paused. Without the
 * device and IP address: they may be someone else's (staff see them in the
 * audit log).
 *
 * @param userId - The user.
 */
async function notifyPasswordSignInPaused(userId: string): Promise<void> {
  const key = `sign-in-paused-notice:user:${userId}`;
  if (!(await hasPassword(db, userId))) {
    return;
  }
  if ((await peekRateLimit({ db }, key, PAUSED_NOTICE_LIMIT)).limited) {
    return;
  }
  const queued = await queueSecurityNotice(db, userId, 'password_sign_in_paused');
  if (queued) {
    await hitRateLimit({ db }, key, PAUSED_NOTICE_LIMIT);
  }
}

/**
 * How often a user is told that wrong codes paused signing in with a code, at
 * most: once per pause. The window is as long as the pause
 * (`TWO_FACTOR_LOCK_MINUTES`, Better Auth's `accountLockout`), and starts
 * once the pause has, so it covers what's left of that pause and ends before
 * the next one can start.
 */
const LOCKED_NOTICE_LIMIT = { limit: 1, windowSeconds: TWO_FACTOR_LOCK_MINUTES * 60 };

/**
 * Tells a user that wrong codes at sign-in paused signing in with a code,
 * once per pause. Better Auth keeps the pause on the user's `two_factor` row
 * (`locked_until`, set once `failed_verification_count` reaches
 * `TWO_FACTOR_LOCK_ATTEMPTS`), so accounts with only email codes, which have
 * none, are never paused or told. Called after every wrong code and every
 * refusal because of a pause, it only sends while the account is paused, and
 * only the first time in the window: counted before it's sent (one atomic
 * statement), so codes refused at the same moment send one notice, and one
 * that couldn't be queued gives its count back, so a later refusal can try
 * again. Without the device and IP address: they're whoever typed the codes,
 * who may be someone else (staff see them in the audit log). Deactivated
 * accounts get none, like the other sign-in emails.
 *
 * @param userId - The user.
 */
async function notifyTwoFactorLocked(userId: string): Promise<void> {
  const [paused] = await db
    .select({ id: twoFactor.id })
    .from(twoFactor)
    .innerJoin(user, eq(user.id, twoFactor.userId))
    .where(
      and(
        eq(twoFactor.userId, userId),
        gt(twoFactor.lockedUntil, new Date()),
        isNull(user.deactivatedAt),
      ),
    )
    .limit(1);
  if (!paused) {
    return;
  }
  const key = `two-factor-locked-notice:user:${userId}`;
  const { allowed } = await hitRateLimit({ db }, key, LOCKED_NOTICE_LIMIT);
  if (!allowed) {
    return;
  }
  const queued = await queueSecurityNotice(db, userId, 'two_factor_locked');
  if (!queued) {
    await releaseRateLimitHit({ db }, key);
  }
}

/**
 * Better Auth's codes for a wrong code at the code step of a password
 * sign-in. Its other 401s there are about the two-factor cookie (missing,
 * expired, or used up by a request at the same moment), not a code.
 */
const WRONG_SIGN_IN_CODE_ERRORS: ReadonlySet<unknown> = new Set([
  'INVALID_CODE',
  'INVALID_BACKUP_CODE',
]);

/** Better Auth's refusal of every code while wrong codes pause signing in with one. */
const TWO_FACTOR_LOCKED_ERROR = 'ACCOUNT_TEMPORARILY_LOCKED';

/**
 * After a code Better Auth refused at the code step of a password sign-in
 * (no session yet; the guards found its user: `pendingCodeSignInOf`).
 *
 * - A wrong code is recorded as `mfa_failed` with `atSignIn: true`, without
 *   an actor, like the password before it (`sign_in_code_pending`): whoever
 *   typed it may not be the user, so the user's own activity leaves out the
 *   IP address and browser (`listOwnActivity`).
 * - After a wrong code (which may have started a pause) or a refusal because
 *   of a pause, the owner is told once per pause, after the response
 *   ({@link notifyTwoFactorLocked}).
 *
 * Other refusals (an expired email code, too many tries for one sign-in) are
 * left alone: no code was compared.
 *
 * @param ctx - The endpoint context, with the refusal.
 * @param path - The endpoint path, one of `CODE_PATHS`.
 * @param refusal - Better Auth's refusal.
 */
async function reactToRefusedSignInCode(
  ctx: AuthHookContext,
  path: string,
  refusal: APIError,
): Promise<void> {
  const userId = pendingCodeSignInOf(ctx);
  if (!userId) {
    return;
  }
  const code = refusal.body?.code;
  const wrongCode = refusal.statusCode === 401 && WRONG_SIGN_IN_CODE_ERRORS.has(code);
  const paused = refusal.statusCode === 429 && code === TWO_FACTOR_LOCKED_ERROR;
  if (!wrongCode && !paused) {
    return;
  }
  if (wrongCode) {
    await recordEvent(auditContext(ctx.headers), {
      action: 'mfa_failed',
      actorUserId: null,
      targetUserId: userId,
      details: { method: mfaMethodFromPath(path), atSignIn: true },
    });
  }
  await runAfterResponse(ctx, notifyTwoFactorLocked(userId));
}

/**
 * Reacts to a request that failed: records a failed password sign-in (and
 * tells the owner when wrong passwords paused password sign-in), a wrong code
 * on the step-up page, or a code refused at a password sign-in's code step.
 *
 * @param ctx - The endpoint context, with its response.
 * @param request - The facts about the request.
 * @param paused - Whether this sign-in paused password sign-in for the address.
 * @returns Whether it handled the request (nothing more to do).
 */
export async function reactToFailure(
  ctx: AuthHookContext,
  request: FinishedRequest,
  paused: boolean,
): Promise<boolean> {
  const { path, returned, failed, sessionUser, email } = request;
  if (path === '/sign-in/email' && failed) {
    const [target] = email
      ? await db
          .select({ id: user.id, deactivatedAt: user.deactivatedAt })
          .from(user)
          .where(eq(user.email, email))
      : [];
    await recordEvent(auditContext(ctx.headers), {
      action: 'sign_in_failed',
      targetUserId: target?.id ?? null,
      details: { method: 'password', email },
    });
    if (paused && target && !target.deactivatedAt) {
      // After the response, so it takes as long whether or not the address has an account.
      await runAfterResponse(ctx, notifyPasswordSignInPaused(target.id));
    }
    return true;
  }

  if (failed && sessionUser && CODE_PATHS.has(path)) {
    // A wrong code on the step-up page, counted above (sign-in attempts are limited by Better
    // Auth itself).
    await audit(ctx, 'mfa_failed', sessionUser.id, { method: mfaMethodFromPath(path) });
    return true;
  }

  if (failed && !sessionUser && CODE_PATHS.has(path) && isAPIError(returned)) {
    // A code refused at a password sign-in's code step, which has no session yet.
    await reactToRefusedSignInCode(ctx, path, returned);
    return true;
  }
  return false;
}
