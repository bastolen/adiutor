/**
 * @file Integration tests for marking "Confirm with GitHub" on the step-up page
 * as a re-verify of the browser's session.
 */
import { addOAuthServerContext, getSessionFromCtx } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { session } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { REVERIFY_HINT } from '@/lib/sign-in/oauth-providers';

import { createSession, createUser, inSequence } from '../../../../tests/integration/helpers';
import { beforeAuthRequest } from './before-request';
import type { AuthGuardContext } from './paths';
import { db, refusedWith } from './test-helpers';

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: vi.fn(),
  // Better Auth's request state isn't there outside a request; the tests watch what's added.
  addOAuthServerContext: vi.fn(),
}));

// Watched, to check when the checks read a user's MFA state; it still reads it.
vi.mock('../mfa-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mfa-state')>();
  return { ...actual, loadMfaContext: vi.fn(actual.loadMfaContext) };
});

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});

beforeEach(() => {
  vi.mocked(getSessionFromCtx).mockReset().mockResolvedValue(null);
  vi.mocked(addOAuthServerContext).mockReset();
});

describe('marking "Confirm with GitHub" as a re-verify', () => {
  /** The session cookie's name in these tests (Better Auth's context names it). */
  const SESSION_COOKIE = 'adiutor-tests.session_token';

  /** The secret the session cookie is signed with in these tests. */
  const SECRET = 'adiutor-tests-secret';

  /** A sign-in from the step-up page's "Confirm with GitHub": GitHub, with the hint. */
  const hinted = {
    provider: 'github',
    callbackURL: '/dashboard',
    errorCallbackURL: '/auth/verify?callbackURL=%2Fdashboard&provider=github',
    additionalData: { [REVERIFY_HINT]: true },
  };

  /**
   * Builds the context of a `/sign-in/social` request.
   *
   * @param body - The request body.
   * @param sessionCookie - What reading the signed session cookie gives: a session's token, `false`
   *   for a cookie whose signature doesn't check out, `null` without one.
   * @returns The context.
   */
  function socialSignIn(
    body: Record<string, unknown>,
    sessionCookie: string | false | null,
  ): AuthGuardContext {
    return {
      path: '/sign-in/social',
      body,
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
   * Reads a session's token, as its signed cookie carries it.
   *
   * @param sessionId - The session.
   * @returns The token.
   */
  async function tokenOf(sessionId: string): Promise<string> {
    const found = firstRow(
      await db.select({ token: session.token }).from(session).where(eq(session.id, sessionId)),
      'the session',
    );
    return found.token;
  }

  it('marks the sign-in with the user and the session of a browser with a live session', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const current = await createSession(db, jane);

    await expect(
      beforeAuthRequest(socialSignIn(hinted, await tokenOf(current))),
    ).resolves.toBeUndefined();

    expect(addOAuthServerContext).toHaveBeenCalledExactlyOnceWith({
      reverify: { userId: jane, sessionId: current },
    });
    // Read from the signed cookie: Better Auth's session lookup would leave the session in the
    // request's context, which the callback shares.
    expect(getSessionFromCtx).not.toHaveBeenCalled();
  });

  it('leaves a sign-in without the hint alone: a plain sign-in with GitHub', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const token = await tokenOf(await createSession(db, jane));
    const { additionalData, ...withoutHint } = hinted;

    await inSequence(
      [
        withoutHint,
        { ...withoutHint, additionalData: {} },
        { ...withoutHint, additionalData: { [REVERIFY_HINT]: 'true' } },
        { ...withoutHint, additionalData: { [REVERIFY_HINT]: false } },
        { ...withoutHint, additionalData: [REVERIFY_HINT] },
        { ...withoutHint, [REVERIFY_HINT]: true },
        // Google can't prove MFA, so it never confirms a session on the step-up page.
        { ...hinted, provider: 'google' },
      ],
      (body) => beforeAuthRequest(socialSignIn(body, token)),
    );

    expect(additionalData).toEqual({ [REVERIFY_HINT]: true });
    expect(addOAuthServerContext).not.toHaveBeenCalled();
  });

  it('refuses a sign-in with a return address that is not a page of the app, before marking it', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const token = await tokenOf(await createSession(db, jane));

    await expect(
      beforeAuthRequest(
        socialSignIn({ ...hinted, callbackURL: '/api/auth/magic-link/verify?token=x' }, token),
      ),
    ).rejects.toEqual(refusedWith('UNSAFE_RETURN_ADDRESS'));

    expect(addOAuthServerContext).not.toHaveBeenCalled();
  });

  it('leaves a browser without a live session alone: no cookie, a forged one, or an expired session', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const expired = await createSession(db, jane, { expiresAt: new Date(Date.now() - 60_000) });

    const cookies: (string | false | null)[] = [
      null,
      false,
      'not-a-session-token',
      await tokenOf(expired),
    ];
    await inSequence(cookies, (cookie) => beforeAuthRequest(socialSignIn(hinted, cookie)));

    expect(addOAuthServerContext).not.toHaveBeenCalled();
  });
});
