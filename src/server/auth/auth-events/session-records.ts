/**
 * @file The session rows several hooks read or update: the request's own live
 * session, its MFA level, and the session a re-verify started from, while the
 * browser still has it.
 */
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { type MfaMethod } from '@/lib/authz/mfa';

import { type ReverifyMarker } from '../reverify-marker';
import { type SignedSession, signedSession } from '../signed-session';
import type { AuthHookContext } from './hook-context';

/**
 * Finds the session a request was made with, if it belongs to this user and
 * hasn't expired (`signedSession`, read from the signed session cookie
 * without touching it). A session token is unique, so the browser's session
 * is this user's or it isn't.
 *
 * @param ctx - The endpoint context.
 * @param userId - The user.
 * @returns The session (its ID, user and MFA facts), or `null` without one.
 */
export async function ownSession(
  ctx: AuthHookContext | null,
  userId: string,
): Promise<SignedSession | null> {
  const current = await signedSession(ctx);
  return current?.userId === userId ? current : null;
}

/**
 * Finds the session a re-verify confirms, when the browser still has it: the
 * request's session ({@link ownSession}) is the one the re-verify was started
 * from, of the user who started it. Not when the browser has another session
 * (or none), or that one expired meanwhile.
 *
 * @param ctx - The endpoint context.
 * @param marker - The re-verify.
 * @returns The session (its ID, user and MFA facts), or `null`.
 */
export async function reverifiedSession(
  ctx: AuthHookContext | null,
  marker: ReverifyMarker,
): Promise<SignedSession | null> {
  const own = await ownSession(ctx, marker.userId);
  return own?.id === marker.sessionId ? own : null;
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
