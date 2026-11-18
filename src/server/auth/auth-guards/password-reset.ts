/**
 * @file The check on password reset links: a first password can't end an
 * account's provider MFA.
 */
import { APIError } from 'better-auth/api';

import { db } from '@/db';
import { mfaGivingProviders, requiresMfa, wouldEndMfa } from '@/lib/authz/mfa';
import { availableProviders } from '@/lib/sign-in/providers';

import { loadMfaContext } from '../mfa-state';
import { checkUnderSignInChangeLock } from './change-lock';
import type { AuthGuardContext } from './paths';
import { resetEndsProviderMfaBody } from './refusal-messages';

/**
 * Reads a reset link's token from a request field, as Better Auth's
 * `/reset-password` does.
 *
 * @param value - The field, as sent.
 * @returns The token, or `null` when the field holds none.
 */
function resetTokenOf(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * Finds the user a password reset link is for: Better Auth's
 * `reset-password:<token>` verification row (welcome links use it too,
 * `registerUser`), read the way `/reset-password` reads it (the body's
 * `token`, otherwise the query's; the stored identifier is hashed, which
 * Better Auth's lookup handles).
 *
 * @param ctx - The endpoint context.
 * @returns The user's ID, or `null` without a token that's stored and not
 *   expired (Better Auth then refuses the request itself, as it would anyway).
 */
async function resetLinkUser(ctx: AuthGuardContext): Promise<string | null> {
  const token = resetTokenOf(ctx.body?.token) ?? resetTokenOf(ctx.query?.token);
  if (!token) {
    return null;
  }
  const found = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
  // The same expiry check as Better Auth's.
  if (!found || found.expiresAt < new Date()) {
    return null;
  }
  return found.value;
}

/**
 * Refuses a password reset that would end the account's MFA: it has no
 * password, and its MFA is a provider account with two-factor authentication,
 * which only counts without one (`wouldEndMfa` with a first password), for
 * every role. Accounts without MFA (a welcome link on a new account) or with
 * a passkey or an authenticator app keep what they have, so their reset goes
 * ahead.
 *
 * @param ctx - The endpoint context, for the request's language.
 * @param userId - The user the link is for.
 * @throws {APIError} `FORBIDDEN` with code `RESET_ENDS_PROVIDER_MFA`, naming the providers.
 */
async function refuseResetEndingMfa(ctx: AuthGuardContext, userId: string): Promise<void> {
  const mfa = await loadMfaContext(db, userId);
  if (!mfa) {
    return;
  }
  const { mfaRole, state } = mfa;
  if (state.hasPassword) {
    return;
  }
  if (!wouldEndMfa(state, mfaRole, { kind: 'set_password' }, availableProviders)) {
    return;
  }
  throw new APIError(
    'FORBIDDEN',
    resetEndsProviderMfaBody(
      ctx,
      mfaGivingProviders(state, availableProviders),
      requiresMfa(mfaRole),
    ),
  );
}

/**
 * The checks for setting a password through a reset or welcome link
 * (`/reset-password`, without a session). A request without a valid link is
 * left to Better Auth, which refuses it. Otherwise the request takes the
 * user's lock before anything about them is read, like the other sign-in
 * changes, so a change at the same moment (removing the passkey that keeps
 * their MFA) can't slip in between the check and the new password; it's given
 * back after the request ({@link releaseSignInChangeLockOf}), or right away
 * when the reset is refused ({@link checkUnderSignInChangeLock}).
 *
 * @param ctx - The endpoint context.
 * @throws {APIError} `CONFLICT` with code `SIGN_IN_CHANGE_IN_PROGRESS` while
 *   another change holds the lock, or `FORBIDDEN` with code
 *   `RESET_ENDS_PROVIDER_MFA` ({@link refuseResetEndingMfa}).
 */
export async function checkPasswordReset(ctx: AuthGuardContext): Promise<void> {
  const userId = await resetLinkUser(ctx);
  if (!userId) {
    return;
  }
  await checkUnderSignInChangeLock(ctx, userId, () => refuseResetEndingMfa(ctx, userId));
}
