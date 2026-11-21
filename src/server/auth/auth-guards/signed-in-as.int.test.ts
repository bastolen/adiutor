/**
 * @file Integration tests for refusing Better Auth's endpoints while a staff
 * member is signed in as a user: the session is theirs, so nothing may change
 * through it, except signing out; reading the session stays open.
 */
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { impersonation, session } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { SIGNED_IN_AS_SOMEONE } from '@/lib/sign-in/sign-in-refusals';

import { createSession, createUser } from '../../../../tests/integration/helpers';
import { beforeAuthRequest } from './before-request';
import type { AuthGuardContext } from './paths';
import { db, refusedWith } from './test-helpers';

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});

/** The session cookie's name in these tests (Better Auth's context names it). */
const SESSION_COOKIE = 'adiutor-tests.session_token';

/** The secret the session cookie is signed with in these tests. */
const SECRET = 'adiutor-tests-secret';

/**
 * Builds the context of a request to an endpoint, made with a session cookie.
 *
 * @param path - The endpoint.
 * @param sessionCookie - What reading the signed session cookie gives: a session's token, `false`
 *   for a cookie whose signature doesn't check out, `null` without one.
 * @param query - The query of a link the browser opens; empty by default.
 * @returns The context.
 */
function requestWith(
  path: string,
  sessionCookie: string | false | null,
  query: Record<string, string> = {},
): AuthGuardContext {
  return {
    path,
    body: {},
    query,
    /**
     * Reads the signed session cookie, as Better Auth does.
     *
     * @param name - The cookie's name.
     * @param secret - The secret it must be signed with.
     * @returns The cookie's value, `false` for a forged one, or `null`.
     */
    getSignedCookie: async (name, secret) =>
      name === SESSION_COOKIE && secret === SECRET ? sessionCookie : null,
    context: {
      secret: SECRET,
      authCookies: { sessionToken: { name: SESSION_COOKIE } },
      /**
       * Builds a cookie name.
       *
       * @param name - The cookie's short name.
       * @returns The cookie.
       */
      createAuthCookie: (name) => ({ name: `adiutor.${name}` }),
      internalAdapter: {
        /**
         * Finds no verification value: none is needed here.
         *
         * @returns `null`.
         */
        findVerificationValue: async () => null,
      },
    },
  };
}

/**
 * A staff member's session signed in as a user, and its token.
 *
 * @returns The session's ID and token.
 */
async function sessionSignedInAs(): Promise<{ id: string; token: string }> {
  const staff = await createUser(db, 'sam@adiutor.test');
  const jane = await createUser(db, 'jane@adiutor.test');
  const id = await createSession(db, staff);
  await db.insert(impersonation).values({
    sessionId: id,
    staffUserId: staff,
    userId: jane,
    returnTo: `/admin/users/${jane}`,
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  const { token } = firstRow(
    await db.select({ token: session.token }).from(session).where(eq(session.id, id)),
    'the session',
  );
  return { id, token };
}

describe('refusing Better Auth while signed in as someone', () => {
  it.each([
    '/update-user',
    '/change-password',
    '/unlink-account',
    '/passkey/generate-register-options',
    '/two-factor/enable',
    '/sign-in/email',
  ])('refuses %s', async (path) => {
    const { token } = await sessionSignedInAs();

    await expect(beforeAuthRequest(requestWith(path, token))).rejects.toEqual(
      refusedWith(SIGNED_IN_AS_SOMEONE.code),
    );
  });

  it('sends the link in an email about a request to its confirmation page instead', async () => {
    const { token } = await sessionSignedInAs();

    const refusal = await beforeAuthRequest(
      requestWith('/request-link/sign-in', token, { token: 'link-token' }),
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(APIError);
    expect(refusal instanceof APIError ? new Headers(refusal.headers).get('location') : null).toBe(
      '/auth/request-link?token=link-token',
    );
  });

  it('leaves reading the session and signing out open', async () => {
    const { token } = await sessionSignedInAs();

    await expect(beforeAuthRequest(requestWith('/get-session', token))).resolves.toBeUndefined();
    await expect(beforeAuthRequest(requestWith('/sign-out', token))).resolves.toBeUndefined();
  });

  it('lets the session through again once it ended, and never trusts a forged cookie', async () => {
    const { id, token } = await sessionSignedInAs();

    await expect(beforeAuthRequest(requestWith('/update-user', false))).resolves.toBeUndefined();
    await db.delete(impersonation).where(eq(impersonation.sessionId, id));
    await expect(beforeAuthRequest(requestWith('/update-user', token))).resolves.toBeUndefined();
  });
});
