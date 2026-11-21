/**
 * @file The hooks for users and their passwords: password resets and first
 * passwords, email addresses verified by email or by a provider.
 */
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { account, user } from '@/db/schema';

import { clearFailedSignIns } from '../failed-sign-ins';
import { databaseHookState } from '../request-state';
import { forgetSecondStepSkips } from '../second-step-skips';
import { safely, audit, auditAndNotify, type AuthHookContext } from './hook-context';

/** How recent a password sign-in must be to count as just created by the reset. */
const JUST_CREATED_MS = 60_000;

/**
 * After a password reset by email link. The link proves the person reads
 * that inbox, so the email address counts as verified, devices trusted for
 * the code step are forgotten and links in emails about requests ended, and a pause on password sign-in after wrong
 * passwords is lifted. When the reset set the
 * account's first password (the welcome link of a registered account), it's
 * recorded as such by `afterAccountCreate`, so nothing more happens here.
 *
 * @param userId - The user whose password was reset.
 * @param headers - Request headers, for IP and browser.
 */
export async function onPasswordReset(userId: string, headers?: Headers): Promise<void> {
  await safely('record password reset', async () => {
    await db
      .update(user)
      .set({ emailVerified: true })
      .where(and(eq(user.id, userId), eq(user.emailVerified, false)));
    // A new password starts afresh: earlier "trust this device" choices no longer skip the code,
    // links in earlier emails about requests no longer sign in, and wrong passwords typed before
    // (by anyone) no longer pause password sign-in.
    await forgetSecondStepSkips(db, userId);
    const [owner] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
    if (owner) {
      await clearFailedSignIns(db, owner.email);
    }
    const [credential] = await db
      .select({ createdAt: account.createdAt })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
    if (credential && Date.now() - credential.createdAt.getTime() < JUST_CREATED_MS) {
      return;
    }
    await auditAndNotify({ headers }, 'password_reset', userId);
  });
}

/**
 * Before a user is changed: notes an email address that a GitHub or Google
 * sign-in verifies, for {@link afterUserUpdate}. The change itself only has
 * the changed fields, not the user.
 *
 * @param data - The changed fields.
 * @param ctx - The endpoint changing them.
 */
export function beforeUserUpdate(data: Record<string, unknown>, ctx: AuthHookContext | null): void {
  if (ctx?.path?.startsWith('/callback/') && data.emailVerified === true) {
    databaseHookState(ctx).verifyingEmailAtProviderSignIn = true;
  }
}

/**
 * After a user is changed: records an email address verified by a GitHub or
 * Google sign-in (see {@link beforeUserUpdate}). The verification link has
 * its own reaction ({@link onEmailVerified}).
 *
 * @param updated - The user after the change.
 * @param updated.id - Their ID.
 * @param ctx - The endpoint that changed them.
 */
export async function afterUserUpdate(
  updated: { id: string },
  ctx: AuthHookContext | null,
): Promise<void> {
  if (!ctx) {
    return;
  }
  const state = databaseHookState(ctx);
  if (!state.verifyingEmailAtProviderSignIn) {
    return;
  }
  delete state.verifyingEmailAtProviderSignIn;
  await safely('record email verification', async () => {
    await audit(ctx, 'email_verified', updated.id, { providerId: ctx.params?.id ?? null });
  });
}

/**
 * After the user verified their email address.
 *
 * @param userId - The user.
 * @param headers - Request headers, for IP and browser.
 */
export async function onEmailVerified(userId: string, headers?: Headers): Promise<void> {
  await safely('record email verification', async () => {
    await audit({ headers }, 'email_verified', userId);
  });
}
