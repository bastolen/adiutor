/**
 * @file The session rows several hooks read or update: the request's own live
 * session, its MFA level, and whether the browser still has the session a
 * re-verify started from.
 */
import { and, eq, gt, sql } from 'drizzle-orm';

import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { type MfaMethod } from '@/lib/authz/mfa';

import { type ReverifyMarker } from '../reverify-marker';
import { signedSession, signedSessionToken } from '../signed-session';
import type { AuthHookContext } from './hook-context';

/**
 * Checks whether the browser still has the live session a re-verify started
 * from (`signedSession`, read from its validly signed session cookie).
 *
 * @param ctx - The endpoint context.
 * @param marker - The re-verify.
 * @returns Whether that session is the browser's, and hasn't expired.
 */
export async function hasReverifySession(
  ctx: AuthHookContext | null,
  marker: ReverifyMarker,
): Promise<boolean> {
  const current = await signedSession(ctx);
  return current?.id === marker.sessionId && current.userId === marker.userId;
}

/**
 * Finds the session a request was made with, if it belongs to this user and
 * hasn't expired (read from the signed session cookie, `signedSessionToken`,
 * without touching it).
 *
 * @param ctx - The endpoint context.
 * @param userId - The user.
 * @returns The session's ID and MFA facts, or `null` without one.
 */
export async function ownSession(
  ctx: AuthHookContext | null,
  userId: string,
): Promise<{
  id: string;
  mfaVerified: boolean | null;
  mfaMethod: string | null;
  mfaVerifiedAt: Date | null;
} | null> {
  const token = await signedSessionToken(ctx);
  if (!token) {
    return null;
  }
  const [found] = await db
    .select({
      id: sessionTable.id,
      mfaVerified: sessionTable.mfaVerified,
      mfaMethod: sessionTable.mfaMethod,
      mfaVerifiedAt: sessionTable.mfaVerifiedAt,
    })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.token, token),
        eq(sessionTable.userId, userId),
        gt(sessionTable.expiresAt, sql`now()`),
      ),
    );
  return found ?? null;
}

/**
 * Marks a session as having passed a second factor, now. Its time
 * (`mfaVerifiedAt`) also opens the window for changing sign-in methods
 * (`mfaConfirmedUntil`), except for a trusted device, where nothing was
 * proven at this sign-in, so none is stored. For a provider such as GitHub
 * the time is stored too, and the window decided when the session is read:
 * it opens only while the account has no passkey or authenticator app.
 *
 * @param sessionId - The session.
 * @param method - Which second factor.
 */
export async function markSessionVerified(sessionId: string, method: MfaMethod): Promise<void> {
  await db
    .update(sessionTable)
    .set({
      mfaVerified: true,
      mfaMethod: method,
      mfaVerifiedAt: method === 'trusted_device' ? null : new Date(),
    })
    .where(eq(sessionTable.id, sessionId));
}
