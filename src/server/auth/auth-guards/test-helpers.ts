/**
 * @file Requests, signed-in sessions and outcomes shared by the integration tests
 * of the checks before Better Auth requests.
 */
import { getSessionFromCtx } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { expect, vi } from 'vitest';

import { rateLimitBucket, user } from '@/db/schema';
import type { MfaMethod } from '@/lib/authz/mfa';
import { firstRow } from '@/lib/defined';

import { inSequence, setupTestContext } from '../../../../tests/integration/helpers';
import { beforeAuthRequest } from './before-request';
import { releaseSignInChangeLockOf } from './change-lock';
import type { AuthGuardContext } from './paths';

/**
 * The test database context these tests share. Each test file imports this
 * module afresh (Vitest isolates test files), so each gets its own context
 * and hooks, as when it called `setupTestContext()` itself.
 */
export const { db } = setupTestContext();

/**
 * Builds the endpoint context of a request.
 *
 * @param path - The endpoint path.
 * @param options - Optional details.
 * @param options.email - The `email` in the body.
 * @param options.body - The whole body (instead of `email`).
 * @param options.pendingUserId - The user of a password sign-in waiting for its code step.
 * @returns The context.
 */
export function request(
  path: string,
  options: { email?: string; body?: Record<string, unknown>; pendingUserId?: string } = {},
): AuthGuardContext {
  return {
    path,
    body: options.body ?? (options.email ? { email: options.email } : {}),
    /**
     * Reads the two-factor cookie of a pending sign-in.
     *
     * @returns Its identifier, or `null` without a pending sign-in.
     */
    getSignedCookie: async () => (options.pendingUserId ? 'pending-sign-in' : null),
    context: {
      secret: 'adiutor-tests-secret',
      /**
       * Builds a cookie name.
       *
       * @param name - The cookie's short name.
       * @returns The cookie.
       */
      createAuthCookie: (name) => ({ name: `adiutor.${name}` }),
      internalAdapter: {
        /**
         * Looks up the user of the pending sign-in.
         *
         * @returns The user's ID as the stored value (expiring in 10 minutes), or `null`.
         */
        findVerificationValue: async () =>
          options.pendingUserId
            ? { value: options.pendingUserId, expiresAt: new Date(Date.now() + 10 * 60_000) }
            : null,
      },
    },
  };
}

/**
 * Makes the next requests come with a session of a user.
 *
 * @param userId - The user.
 * @param options - The session's facts.
 * @param options.verifiedWith - The second factor the session was confirmed with, if any.
 * @param options.verifiedAt - When it was confirmed; defaults to now with `verifiedWith` (a
 *   sign-in or step-up just now), otherwise `null`.
 * @param options.signedInAt - When it signed in (Better Auth's `createdAt`); defaults to now.
 */
export async function signedIn(
  userId: string,
  options: { verifiedWith?: MfaMethod; verifiedAt?: Date | null; signedInAt?: Date } = {},
): Promise<void> {
  const found = firstRow(
    await db
      .select({ twoFactorEnabled: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, userId)),
    'the user',
  );
  const justNow = options.verifiedWith ? new Date() : null;
  vi.mocked(getSessionFromCtx).mockResolvedValue({
    session: {
      createdAt: options.signedInAt ?? new Date(),
      mfaVerified: Boolean(options.verifiedWith),
      mfaMethod: options.verifiedWith ?? null,
      mfaVerifiedAt: options.verifiedAt === undefined ? justNow : options.verifiedAt,
    },
    user: { id: userId, twoFactorEnabled: found.twoFactorEnabled },
  } as unknown as Awaited<ReturnType<typeof getSessionFromCtx>>);
}

/**
 * Sends a request with the current session and tells how the checks answered.
 * An allowed change gives its lock back afterwards, as the reactions after a
 * request do.
 *
 * @param path - The endpoint path.
 * @param body - The request body; empty by default.
 * @returns `allowed`, or the refusal's error code.
 */
export async function outcomeOf(path: string, body: Record<string, unknown> = {}): Promise<string> {
  const ctx = request(path, { body });
  try {
    await beforeAuthRequest(ctx);
  } catch (error) {
    return (error as { body?: { code?: string } }).body?.code ?? String(error);
  }
  // The reactions after a request get their own context object; only `context` is shared.
  await releaseSignInChangeLockOf({ context: ctx.context });
  return 'allowed';
}

/**
 * Reads how often a limit was hit.
 *
 * @param key - The limit's key.
 * @returns The count, or `null` when it was never hit.
 */
export async function hits(key: string): Promise<number | null> {
  const [bucket] = await db
    .select({ count: rateLimitBucket.count })
    .from(rateLimitBucket)
    .where(eq(rateLimitBucket.key, key));
  return bucket?.count ?? null;
}

/**
 * Sends the same request several times, one after another.
 *
 * @param times - How often.
 * @param ctx - The request.
 */
export async function repeat(times: number, ctx: AuthGuardContext): Promise<void> {
  await inSequence(Array.from({ length: times }), () => beforeAuthRequest(ctx));
}

/**
 * Lets the wait for a user's next emailed code pass, as if
 * `EMAIL_CODE_RESEND_SECONDS` had gone by.
 *
 * @param userId - The user.
 */
export async function waitForNextCode(userId: string): Promise<void> {
  await db
    .update(rateLimitBucket)
    .set({ resetAt: new Date(Date.now() - 1000) })
    .where(eq(rateLimitBucket.key, `email-code-cooldown:user:${userId}`));
}

/**
 * Sends the same code request several times, letting the wait for a new code
 * pass before each.
 *
 * @param times - How often.
 * @param ctx - The request.
 * @param userId - Whose codes they are.
 */
export async function sendCodesOverTime(
  times: number,
  ctx: AuthGuardContext,
  userId: string,
): Promise<void> {
  await inSequence(Array.from({ length: times }), async () => {
    await waitForNextCode(userId);
    await beforeAuthRequest(ctx);
  });
}

/**
 * Matches a refusal with a Better Auth error code.
 *
 * @param code - The expected code.
 * @returns The matcher.
 */
export const refusedWith = (code: string) =>
  expect.objectContaining({ body: expect.objectContaining({ code }) });
