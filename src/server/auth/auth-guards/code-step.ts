/**
 * @file The checks at a password sign-in's code step, before there's a session:
 * which codes are accepted, and the user the reactions record a wrong code
 * for.
 */
import { db } from '@/db';
import { allowsEmailCodesAtSignIn } from '@/lib/authz/mfa';

import { loadMfaContext } from '../mfa-state';
import { requestState } from '../request-state';
import { limitEmailCode } from './attempts';
import {
  type AuthGuardContext,
  refuseUnfinishedBackupCodes,
  EMAIL_CODE_PATHS,
  refuseEmailCodes,
} from './paths';

/**
 * Finds the user of a sign-in that's waiting for its code step, from Better
 * Auth's two-factor cookie.
 *
 * @param ctx - The endpoint context.
 * @returns The user's ID, or `null` without a (valid) pending sign-in.
 */
async function pendingSignInUser(ctx: AuthGuardContext): Promise<string | null> {
  const cookie = ctx.context.createAuthCookie('two_factor');
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) {
    return null;
  }
  const found = await ctx.context.internalAdapter.findVerificationValue(identifier);
  return found?.value ?? null;
}

/**
 * Finds the user whose sign-in a code was checked for at the code step (see
 * `pendingCodeSignIn` in `request-state.ts`).
 *
 * @param ctx - The endpoint context (its `context` is shared with the checks before).
 * @param ctx.context - Better Auth's request state.
 * @returns The user's ID, or `null` when the request didn't check a code of a
 *   pending sign-in (a code checked with a session, or no valid two-factor cookie).
 */
export function pendingCodeSignInOf(ctx: { context: object }): string | null {
  return requestState(ctx.context).pendingCodeSignIn ?? null;
}

/**
 * The checks for the code step of a password sign-in, which has no session
 * yet: backup codes only once their authenticator app is set up, email codes
 * only where they're accepted at sign-in (`allowsEmailCodesAtSignIn`), and
 * emailed codes limited per user. Wrong codes there are limited by Better
 * Auth itself (5 per sign-in or emailed code, and a pause after
 * `TWO_FACTOR_LOCK_ATTEMPTS` in a row). Each code it goes on to check hands
 * its user to the reactions after the request ({@link pendingCodeSignInOf}),
 * which record a wrong one. A request without a (valid) pending sign-in is
 * left to Better Auth, which refuses it.
 *
 * @param ctx - The endpoint context.
 * @param path - The endpoint path, one of {@link STEP_PATHS}.
 * @throws {APIError} When the request is refused.
 */
export async function checkCodeStep(ctx: AuthGuardContext, path: string): Promise<void> {
  const userId = await pendingSignInUser(ctx);
  if (!userId) {
    return;
  }
  // An authenticator code needs no checks here: Better Auth refuses it without an app.
  const mfa = path === '/two-factor/verify-totp' ? null : await loadMfaContext(db, userId);
  if (path === '/two-factor/verify-backup-code' && mfa && !mfa.state.authenticator) {
    refuseUnfinishedBackupCodes();
  }
  if (EMAIL_CODE_PATHS.has(path) && mfa && !allowsEmailCodesAtSignIn(mfa.state)) {
    refuseEmailCodes();
  }
  if (path === '/two-factor/send-otp') {
    await limitEmailCode(userId, true);
    return;
  }
  // Last, so only a code Better Auth goes on to check is handed over.
  requestState(ctx.context).pendingCodeSignIn = userId;
}
