/**
 * @file Integration tests for confirming a session with GitHub on the step-up
 * page.
 */
import { APIError, getOAuthState } from 'better-auth/api';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

import { auditEvent, session } from '@/db/schema';
import { sendEmail } from '@/lib/email';
import { PROVIDER_STEP_UP_COOKIE } from '@/lib/sign-in/oauth-providers';

import {
  createSession,
  createUser,
  inSequence,
  lastActiveAt,
  minutesAgo,
} from '../../../../tests/integration/helpers';
import { afterAuthRequest } from './after-request';
import type { AuthHookContext } from './hook-context';
import { afterAccountCreate } from './provider-accounts';
import { afterSessionCreate, beforeSessionCreate } from './session-hooks';
import {
  events,
  githubCallback,
  gitHubAccountIdOf,
  mockGitHubApi,
  db,
  connectGitHubWithToken,
  markReverify,
  signedInHeaders,
  sessionMfa,
  sessionExists,
  expectSetSince,
  storeSessionMfa,
  sessionVerifiedAt,
  noticeCookies,
} from './test-helpers';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

// The checks before a request read its session from Better Auth, and the reactions read the OAuth
// state (only there during a request); the tests hand both over.
vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: vi.fn(),
  getOAuthState: vi.fn(),
}));

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});

beforeEach(() => {
  vi.mocked(sendEmail).mockClear();
  // No OAuth sign-in marked as a re-verify, unless a test marks one (`markReverify`).
  vi.mocked(getOAuthState).mockReset().mockResolvedValue(null);
});

afterEach(() => {
  // Puts back the real `fetch` after tests that stand in for GitHub's API.
  vi.restoreAllMocks();
});

describe('confirming a session with GitHub on the step-up page', () => {
  /** Where the new session was created from, as Better Auth stores it. */
  const BROWSER = { ipAddress: '203.0.113.7', userAgent: 'Adiutor Tests browser' };

  /**
   * Lists the recorded events as action, actor and details.
   *
   * @returns The events, oldest first.
   */
  const recorded = async () =>
    (await events()).map(({ action, actorUserId, details }) => [action, actorUserId, details]);

  /**
   * Runs the hooks of a provider callback that created a session with one
   * context, as Better Auth does: the session hook when it creates the
   * session, then the reactions after the request.
   *
   * @param ctx - The callback's context, e.g. from {@link githubCallback}.
   * @param created - The session it created.
   * @param created.sessionId - Its ID.
   * @param created.userId - Its user.
   * @returns The events this callback recorded once the session was
   *   created (`atOnce`), and once the request was done (`afterRequest`).
   */
  async function runCallback(
    ctx: AuthHookContext,
    created: { sessionId: string; userId: string },
  ): Promise<{ atOnce: unknown[][]; afterRequest: unknown[][] }> {
    const before = (await recorded()).length;
    await afterSessionCreate({ id: created.sessionId, userId: created.userId, ...BROWSER }, ctx);
    const atOnce = (await recorded()).slice(before);
    await afterAuthRequest(ctx);
    return { atOnce, afterRequest: (await recorded()).slice(before) };
  }

  /**
   * Adds the cookie an earlier "Confirm with GitHub" left to a browser's
   * request headers, URL-encoded as the server sets it.
   *
   * @param headers - The browser's request headers.
   * @param value - The cookie's value, e.g. `github:mfa-off`.
   * @returns The same headers.
   */
  function withStepUpCookie(headers: Headers, value: string): Headers {
    const cookie = `${PROVIDER_STEP_UP_COOKIE}=${encodeURIComponent(value)}`;
    headers.set('cookie', [headers.get('cookie'), cookie].filter(Boolean).join('; '));
    return headers;
  }

  /**
   * Lists what a request did with the step-up page's notice cookie.
   *
   * @param setCookie - The request's `setCookie` mock.
   * @returns The values it set, in order: `''` when it removed it.
   */
  const stepUpCookies = (setCookie: ReturnType<typeof githubCallback>['setCookie']) =>
    setCookie.mock.calls
      .filter(([name]) => name === PROVIDER_STEP_UP_COOKIE)
      .map(([, value]) => value);

  it('records only that the session was confirmed, once GitHub confirmed it with 2FA', async () => {
    mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHubWithToken(jane, 'jane-token');
    const previous = await createSession(db, jane);
    markReverify(jane, previous);
    const created = { sessionId: await createSession(db, jane), userId: jane };
    const start = new Date();

    const { ctx, setCookie } = githubCallback(
      await signedInHeaders(previous),
      created,
      gitHubAccountIdOf('jane-token'),
    );

    // Whether GitHub confirmed it is only known after the request, so nothing is recorded before.
    expect(await runCallback(ctx, created)).toEqual({
      atOnce: [],
      afterRequest: [['mfa_verified', jane, { method: 'github' }]],
    });
    // From where the new session was created, like a passkey step-up.
    expect(
      await db.select({ ip: auditEvent.ip, userAgent: auditEvent.userAgent }).from(auditEvent),
    ).toEqual([{ ip: BROWSER.ipAddress, userAgent: BROWSER.userAgent }]);
    expect(await sessionMfa(created.sessionId)).toEqual({ mfaVerified: true, mfaMethod: 'github' });
    expect(await sessionExists(previous)).toBe(false);
    expectSetSince(await lastActiveAt(db, jane), start);
    // Nothing for the next page to say.
    expect(noticeCookies(setCookie)).toEqual([]);
  });

  it('removes what an earlier attempt left for the next page, once GitHub confirmed the session', async () => {
    mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHubWithToken(jane, 'jane-token');
    const previous = await createSession(db, jane);
    markReverify(jane, previous);
    const created = { sessionId: await createSession(db, jane), userId: jane };

    const headers = withStepUpCookie(await signedInHeaders(previous), 'github:unchecked');
    const { ctx, setCookie } = githubCallback(headers, created, gitHubAccountIdOf('jane-token'));
    await runCallback(ctx, created);

    expect(stepUpCookies(setCookie)).toEqual(['']);
    expect(setCookie).toHaveBeenCalledWith(
      PROVIDER_STEP_UP_COOKIE,
      '',
      expect.objectContaining({ maxAge: 0, path: '/' }),
    );
  });

  // Another GitHub account than Jane's own confirmed one never gets this far: `checkReverify`
  // refuses it before a session is created (see "refusing a re-verify with another account").
  it.each([
    ['GitHub says 2FA is off', () => mockGitHubApi({ 'jane-token': false }), 'mfa-off'],
    [
      'GitHub is unreachable',
      () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
        // The failure is logged; keep the test output clean.
        vi.spyOn(console, 'error').mockImplementation(() => {});
      },
      'unchecked',
    ],
    [
      'GitHub doesn’t answer in time',
      () => {
        // What `fetch` rejects with when the check's time limit runs out (`AbortSignal.timeout`).
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(
          new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
        );
        // The failure is logged; keep the test output clean.
        vi.spyOn(console, 'error').mockImplementation(() => {});
      },
      'unchecked',
    ],
  ])(
    'records a sign-in with GitHub when %s, since a session was still created with it, and tells the next page why',
    async (_, standIn: () => void, outcome: string) => {
      standIn();
      const jane = await createUser(db, 'jane@adiutor.test');
      await connectGitHubWithToken(jane, 'jane-token');
      const previous = await createSession(db, jane);
      markReverify(jane, previous);
      const created = { sessionId: await createSession(db, jane), userId: jane };

      const { ctx, setCookie } = githubCallback(
        await signedInHeaders(previous),
        created,
        gitHubAccountIdOf('jane-token'),
      );

      expect(await runCallback(ctx, created)).toEqual({
        atOnce: [],
        afterRequest: [['sign_in', jane, { method: 'github' }]],
      });
      expect(await sessionMfa(created.sessionId)).toEqual({ mfaVerified: false, mfaMethod: null });
      expect(noticeCookies(setCookie)).toHaveLength(1);
      expect(setCookie).toHaveBeenCalledWith(
        PROVIDER_STEP_UP_COOKIE,
        `github:${outcome}`,
        expect.objectContaining({ maxAge: 300, path: '/', httpOnly: false, sameSite: 'lax' }),
      );
    },
  );

  /**
   * Runs a whole "Confirm with GitHub" for a browser whose session was
   * confirmed with a passkey 20 minutes ago: the session hook decides the
   * new session's MFA facts (`beforeSessionCreate`), which are stored as
   * Better Auth would, then the reactions run.
   *
   * @returns The browser's old session, the new one, and the old confirmation's time.
   */
  async function confirmWithGitHubAfterPasskey() {
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHubWithToken(jane, 'jane-token');
    const previous = await createSession(db, jane);
    const confirmedAt = minutesAgo(20);
    await storeSessionMfa(previous, 'passkey', confirmedAt);
    markReverify(jane, previous);
    const headers = await signedInHeaders(previous);
    const { data } = await beforeSessionCreate({ userId: jane }, githubCallback(headers).ctx);
    const sessionId = await createSession(db, jane);
    await db
      .update(session)
      .set({
        mfaVerified: Boolean(data.mfaVerified),
        mfaMethod: (data.mfaMethod as string | null) ?? null,
        mfaVerifiedAt: (data.mfaVerifiedAt as Date | null) ?? null,
      })
      .where(eq(session.id, sessionId));
    const created = { sessionId, userId: jane };
    await runCallback(
      githubCallback(headers, created, gitHubAccountIdOf('jane-token')).ctx,
      created,
    );
    return { previous, created: sessionId, confirmedAt };
  }

  it.each([
    ['GitHub says 2FA is off', () => mockGitHubApi({ 'jane-token': false })],
    [
      'GitHub is unreachable',
      () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
      },
    ],
  ])(
    "keeps the session's earlier confirmation as it was when %s",
    async (_, standIn: () => void) => {
      standIn();
      const { previous, created, confirmedAt } = await confirmWithGitHubAfterPasskey();

      // The attempt that didn't count takes nothing away, and opens no new window either.
      expect(await sessionMfa(created)).toEqual({ mfaVerified: true, mfaMethod: 'passkey' });
      expect(await sessionVerifiedAt(created)).toEqual(confirmedAt);
      expect(await sessionExists(previous)).toBe(false);
    },
  );

  it('confirms the session afresh when GitHub confirmed it with 2FA', async () => {
    mockGitHubApi({ 'jane-token': true });
    const start = new Date();
    const { created } = await confirmWithGitHubAfterPasskey();

    expect(await sessionMfa(created)).toEqual({ mfaVerified: true, mfaMethod: 'github' });
    expectSetSince(await sessionVerifiedAt(created), start);
  });

  it('replaces what an earlier attempt left for the next page, without removing it in the same response', async () => {
    mockGitHubApi({ 'jane-token': false });
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHubWithToken(jane, 'jane-token');
    const previous = await createSession(db, jane);
    markReverify(jane, previous);
    const created = { sessionId: await createSession(db, jane), userId: jane };

    const headers = withStepUpCookie(await signedInHeaders(previous), 'github:unchecked');
    const { ctx, setCookie } = githubCallback(headers, created, gitHubAccountIdOf('jane-token'));
    await runCallback(ctx, created);

    expect(stepUpCookies(setCookie)).toEqual(['github:mfa-off']);
  });

  it('still records the session once when the request fails after creating it', async () => {
    const fetchSpy = mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHubWithToken(jane, 'jane-token');
    const previous = await createSession(db, jane);
    markReverify(jane, previous);
    const created = { sessionId: await createSession(db, jane), userId: jane };

    const { ctx, setCookie } = githubCallback(await signedInHeaders(previous), created);
    ctx.context.returned = new APIError('INTERNAL_SERVER_ERROR');

    // The provider check never ran, so the session didn't count as a step-up.
    expect(await runCallback(ctx, created)).toEqual({
      atOnce: [],
      afterRequest: [['sign_in', jane, { method: 'github' }]],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    // So GitHub couldn't be checked: the user may try again.
    expect(stepUpCookies(setCookie)).toEqual(['github:unchecked']);
  });

  it('records one sign-in at once when the browser no longer has the session the re-verify started from', async () => {
    mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const bob = await createUser(db, 'bob@adiutor.test');
    await connectGitHubWithToken(jane, 'jane-token');
    const started = await createSession(db, jane);
    const expired = await createSession(db, jane);
    await db
      .update(session)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(session.id, expired));

    // The re-verify each browser's callback finishes, and the browser's cookie then.
    const browsers: [string, Headers][] = [
      [started, new Headers()],
      [started, await signedInHeaders(started, 'not-the-secret')],
      [expired, await signedInHeaders(expired)],
      [started, await signedInHeaders(await createSession(db, bob))],
      // Another session of Jane's than the one the re-verify confirms.
      [started, await signedInHeaders(await createSession(db, jane))],
    ];
    const outcomes = await inSequence(browsers, async ([reverified, headers]) => {
      markReverify(jane, reverified);
      const created = { sessionId: await createSession(db, jane), userId: jane };
      const { ctx, setCookie } = githubCallback(headers, created);
      return {
        ...(await runCallback(ctx, created)),
        cookiesSet: noticeCookies(setCookie).length,
      };
    });

    // A sign-in, not a step-up: nothing for the next page to say.
    const signIn = [['sign_in', jane, { method: 'github' }]];
    expect(outcomes).toEqual(
      browsers.map(() => ({ atOnce: signIn, afterRequest: signIn, cookiesSet: 0 })),
    );
  });

  it('records a plain sign-in with GitHub as a sign-in, even on a browser signed in as the same user', async () => {
    mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHubWithToken(jane, 'jane-token');
    const previous = await createSession(db, jane);
    const created = { sessionId: await createSession(db, jane), userId: jane };

    // No re-verify marker: e.g. GitHub on a sign-in page opened before signing in (another tab).
    const { ctx, setCookie } = githubCallback(
      await signedInHeaders(previous),
      created,
      gitHubAccountIdOf('jane-token'),
    );

    const signIn = [['sign_in', jane, { method: 'github' }]];
    expect(await runCallback(ctx, created)).toEqual({ atOnce: signIn, afterRequest: signIn });
    // GitHub's 2FA still confirms the new session, as at any GitHub sign-in.
    expect(await sessionMfa(created.sessionId)).toEqual({ mfaVerified: true, mfaMethod: 'github' });
    expect(await sessionExists(previous)).toBe(false);
    expect(noticeCookies(setCookie)).toEqual([]);
  });

  it('never treats a re-verify started by another user as this user’s step-up', async () => {
    mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const bob = await createUser(db, 'bob@adiutor.test');
    await connectGitHubWithToken(jane, 'jane-token');
    const previous = await createSession(db, jane);
    markReverify(bob, await createSession(db, bob));
    const created = { sessionId: await createSession(db, jane), userId: jane };

    const { ctx } = githubCallback(await signedInHeaders(previous), created);

    const signIn = [['sign_in', jane, { method: 'github' }]];
    expect((await runCallback(ctx, created)).atOnce).toEqual(signIn);
  });

  it('removes what an earlier attempt left for the next page when another sign-in starts on the browser', async () => {
    mockGitHubApi({ 'john-token': true });
    const john = await createUser(db, 'john@adiutor.test');
    await connectGitHubWithToken(john, 'john-token');
    const created = { sessionId: await createSession(db, john), userId: john };

    // Jane's "Confirm with GitHub" didn't count, and John signs in on the same browser.
    const { ctx, setCookie } = githubCallback(
      withStepUpCookie(new Headers(), 'github:mfa-off'),
      created,
    );
    await runCallback(ctx, created);

    expect(stepUpCookies(setCookie)).toEqual(['']);
  });

  it('records a sign-in with Google at once, which can’t confirm a session', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const previous = await createSession(db, jane);
    const created = { sessionId: await createSession(db, jane), userId: jane };

    const { ctx, setCookie } = githubCallback(await signedInHeaders(previous), created);
    ctx.params = { id: 'google' };

    const signIn = [['sign_in', jane, { method: 'google' }]];
    expect(await runCallback(ctx, created)).toEqual({ atOnce: signIn, afterRequest: signIn });
    expect(noticeCookies(setCookie)).toEqual([]);
  });

  it('records no session for a connection from the Security page, which creates none', async () => {
    mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const current = await createSession(db, jane);
    // Reconnecting an account that's connected already only updates it.
    await connectGitHubWithToken(jane, 'jane-token');

    const { ctx, setCookie } = githubCallback(await signedInHeaders(current));
    await afterAuthRequest(ctx);

    expect(await recorded()).toEqual([]);
    expect(await sessionExists(current)).toBe(true);
    expect(noticeCookies(setCookie)).toEqual([]);
  });

  it('records a sign-in when a plain sign-in connected a new GitHub account', async () => {
    mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const previous = await createSession(db, jane);
    const created = { sessionId: await createSession(db, jane), userId: jane };

    const { ctx, setCookie } = githubCallback(await signedInHeaders(previous), created);
    // Better Auth connected a GitHub account with Jane's verified address, then created the session.
    // (A re-verify never gets this far: `checkReverify` refuses a new account.)
    const connected = await connectGitHubWithToken(jane, 'jane-token');
    await afterAccountCreate(
      { id: connected, userId: jane, providerId: 'github', confirmed: true },
      ctx,
    );

    const signIn = [['sign_in', jane, { method: 'github' }]];
    expect(await runCallback(ctx, created)).toEqual({ atOnce: signIn, afterRequest: signIn });
    expect((await recorded()).map(([action]) => action)).toEqual(['provider_connected', 'sign_in']);
    expect(noticeCookies(setCookie)).toEqual([]);
  });
});
