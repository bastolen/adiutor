/**
 * @file Reads the session a Better Auth request was made with from its
 * session cookie, only when the cookie's signature checks out (as Better
 * Auth itself does), for the checks before a request (`auth-guards/`, the
 * re-verify marker) and the reactions after it (`auth-events/`), where
 * Better Auth hasn't loaded the session: the database alone (e.g. a leaked
 * copy) must not be enough to pass for a session. Never touches the session.
 */
import { and, eq, gt, sql } from 'drizzle-orm';

import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';

/** The parts of a Better Auth endpoint context that reading its session cookie needs. */
export interface SessionCookieContext {
  /**
   * Reads a cookie of the request whose signature checks out with the
   * secret: its value, `false` for a wrong signature, `null` without one.
   */
  getSignedCookie?: (name: string, secret: string) => Promise<string | null | false>;
  /** Better Auth's request state. */
  context: {
    /** Better Auth's cookie names. */
    authCookies?: { sessionToken: { name: string } };
    /** The secret Better Auth signs cookies with. */
    secret?: string;
  };
}

/**
 * Reads the session token from the request's session cookie, only when its
 * signature checks out, as Better Auth itself does: the database alone (e.g.
 * a leaked copy) must not be enough to pass for a session.
 *
 * @param ctx - The endpoint context.
 * @returns The token, or `null` without a validly signed session cookie.
 */
export async function signedSessionToken(ctx: SessionCookieContext | null): Promise<string | null> {
  const name = ctx?.context.authCookies?.sessionToken.name;
  const secret = ctx?.context.secret;
  if (!name || !secret || !ctx.getSignedCookie) {
    return null;
  }
  return (await ctx.getSignedCookie(name, secret)) || null;
}

/** The live session a request was made with, as its signed session cookie names it. */
export interface SignedSession {
  /** Its ID. */
  id: string;
  /** Its user. */
  userId: string;
  /** Whether its sign-in, or a later step-up, had a second factor. */
  mfaVerified: boolean | null;
  /** Which second factor, if known. */
  mfaMethod: string | null;
  /** When it was proven, if known. */
  mfaVerifiedAt: Date | null;
  /** Whether the link in an email about a request started it (decision 0035). */
  fromRequestLink: boolean | null;
}

/**
 * Finds the live session a request was made with: the one its validly
 * signed session cookie names, if it hasn't expired.
 *
 * @param ctx - The endpoint context.
 * @returns The session's ID, user and MFA facts, or `null` without such a session.
 */
export async function signedSession(
  ctx: SessionCookieContext | null,
): Promise<SignedSession | null> {
  const token = await signedSessionToken(ctx);
  if (!token) {
    return null;
  }
  const [found] = await db
    .select({
      id: sessionTable.id,
      userId: sessionTable.userId,
      mfaVerified: sessionTable.mfaVerified,
      mfaMethod: sessionTable.mfaMethod,
      mfaVerifiedAt: sessionTable.mfaVerifiedAt,
      fromRequestLink: sessionTable.fromRequestLink,
    })
    .from(sessionTable)
    .where(and(eq(sessionTable.token, token), gt(sessionTable.expiresAt, sql`now()`)));
  return found ?? null;
}
