/**
 * @file Integration tests for OAuth tokens (never kept) and the provider MFA
 * checked with them.
 */
import { APIError, getOAuthState } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

import { account } from '@/db/schema';
import { sendEmail } from '@/lib/email';
import { PROVIDER_STEP_UP_COOKIE } from '@/lib/sign-in/oauth-providers';

import { createSession, createUser } from '../../../../tests/integration/helpers';
import { afterAuthRequest } from './after-request';
import { afterAccountCreate, beforeAccountCreate, beforeAccountUpdate } from './provider-accounts';
import { afterSessionCreate } from './session-hooks';
import {
  mockGitHubApi,
  db,
  connectGitHubWithToken,
  githubCallback,
  sessionMfa,
  signedInHeaders,
  storedGitHubMfa,
  markReverify,
  events,
  cookiesBesidesLanguage,
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

/**
 * Reads which access tokens were sent to GitHub's API.
 *
 * @param fetchSpy - The spy from {@link mockGitHubApi}.
 * @returns The `Authorization` headers, in order.
 */
function githubApiTokens(fetchSpy: ReturnType<typeof mockGitHubApi>): (string | null)[] {
  return fetchSpy.mock.calls.map(([, init]) => new Headers(init?.headers).get('authorization'));
}

describe('OAuth tokens', () => {
  /** Tokens as a provider hands them over. */
  const tokens = {
    accessToken: 'adiutor-tests-access',
    refreshToken: 'adiutor-tests-refresh',
    idToken: 'adiutor-tests-id',
  };

  /**
   * Reads the tokens stored on a user's accounts.
   *
   * @param userId - The user.
   * @returns Each account's tokens.
   */
  async function storedTokens(userId: string) {
    return db
      .select({
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        idToken: account.idToken,
      })
      .from(account)
      .where(eq(account.userId, userId));
  }

  it('keeps only the GitHub access token, which the 2FA check needs during the request', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const github = { userId: jane, providerId: 'github', accountId: 'jane-github', ...tokens };
    const google = { userId: jane, providerId: 'google', accountId: 'jane-google', ...tokens };

    expect((await beforeAccountCreate(github, null)).data).toMatchObject({
      accessToken: tokens.accessToken,
      refreshToken: null,
      idToken: null,
    });
    expect((await beforeAccountCreate(google, null)).data).toMatchObject({
      accessToken: null,
      refreshToken: null,
      idToken: null,
    });
    // New tokens at a sign-in, and a changed password.
    expect(beforeAccountUpdate({ providerId: 'google', ...tokens }).data).toEqual({
      providerId: 'google',
      accessToken: null,
      refreshToken: null,
      idToken: null,
    });
    expect(beforeAccountUpdate({ providerId: 'github', ...tokens }).data).toEqual({
      providerId: 'github',
      accessToken: tokens.accessToken,
      refreshToken: null,
      idToken: null,
    });
    expect(beforeAccountUpdate({ password: 'hashed' }).data).toEqual({ password: 'hashed' });
  });

  it("forgets the GitHub token once the sign-in is checked, and leaves other users' alone", async () => {
    mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHubWithToken(jane, 'jane-token');
    const john = await createUser(db, 'john@adiutor.test');
    await connectGitHubWithToken(john, 'john-token');
    const janeSession = await createSession(db, jane);

    await afterAuthRequest(
      githubCallback(new Headers(), { sessionId: janeSession, userId: jane }).ctx,
    );

    expect(await sessionMfa(janeSession)).toEqual({ mfaVerified: true, mfaMethod: 'github' });
    expect(await storedTokens(jane)).toEqual([
      { accessToken: null, refreshToken: null, idToken: null },
    ]);
    expect(await storedTokens(john)).toEqual([
      { accessToken: 'john-token', refreshToken: null, idToken: null },
    ]);
  });

  it('forgets the token after a connection from the Security page, whose callback has no session', async () => {
    mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const janeSession = await createSession(db, jane);
    // Better Auth created the account during the callback, with the session cookie but no session.
    const connected = await connectGitHubWithToken(jane, 'jane-token');
    const { ctx } = githubCallback(await signedInHeaders(janeSession));

    await afterAccountCreate({ id: connected, userId: jane, providerId: 'github' }, ctx);
    await afterAuthRequest(ctx);

    expect(await storedGitHubMfa(connected)).toBe(true);
    expect(await storedTokens(jane)).toEqual([
      { accessToken: null, refreshToken: null, idToken: null },
    ]);
  });

  it('checks and forgets a reconnected GitHub account, which Better Auth only updates', async () => {
    const fetchSpy = mockGitHubApi({ 'fresh-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const janeSession = await createSession(db, jane);
    const reconnected = await connectGitHubWithToken(jane, 'fresh-token', { mfaVerified: false });

    await afterAuthRequest(githubCallback(await signedInHeaders(janeSession)).ctx);

    expect(githubApiTokens(fetchSpy)).toEqual(['Bearer fresh-token']);
    expect(await storedGitHubMfa(reconnected)).toBe(true);
    expect(await storedTokens(jane)).toEqual([
      { accessToken: null, refreshToken: null, idToken: null },
    ]);
  });

  it('forgets them after a failed connection too, without checking', async () => {
    const fetchSpy = mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const janeSession = await createSession(db, jane);
    await connectGitHubWithToken(jane, 'jane-token');
    const { ctx } = githubCallback(await signedInHeaders(janeSession));
    ctx.context.returned = new APIError('BAD_REQUEST', { code: 'UNABLE_TO_LINK_ACCOUNT' });

    await afterAuthRequest(ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await storedTokens(jane)).toEqual([
      { accessToken: null, refreshToken: null, idToken: null },
    ]);
  });

  it('leaves the tokens to the hourly clean-up when the session cookie is forged', async () => {
    const fetchSpy = mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const janeSession = await createSession(db, jane);
    await connectGitHubWithToken(jane, 'jane-token');

    await afterAuthRequest(
      githubCallback(await signedInHeaders(janeSession, 'not-the-secret')).ctx,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await storedTokens(jane)).toEqual([
      { accessToken: 'jane-token', refreshToken: null, idToken: null },
    ]);
  });
});

describe('checking GitHub two-factor authentication', () => {
  it('checks the account just connected, not another GitHub account of the user', async () => {
    const fetchSpy = mockGitHubApi({ 'used-token': false, 'new-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const used = await connectGitHubWithToken(jane, 'used-token');
    const connected = await connectGitHubWithToken(jane, 'new-token', {
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    await afterAccountCreate(
      { id: connected, userId: jane, providerId: 'github', confirmed: true },
      githubCallback().ctx,
    );

    expect(githubApiTokens(fetchSpy)).toEqual(['Bearer new-token']);
    expect(await storedGitHubMfa(connected)).toBe(true);
    expect(await storedGitHubMfa(used)).toBe(false);
  });

  it('checks the GitHub account that signed in: the one Better Auth updated last', async () => {
    const fetchSpy = mockGitHubApi({ 'stale-token': false, 'fresh-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const stale = await connectGitHubWithToken(jane, 'stale-token', {
      updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const fresh = await connectGitHubWithToken(jane, 'fresh-token');
    const newSession = await createSession(db, jane);

    await afterAuthRequest(
      githubCallback(new Headers(), { sessionId: newSession, userId: jane }).ctx,
    );

    expect(githubApiTokens(fetchSpy)).toEqual(['Bearer fresh-token']);
    expect(await storedGitHubMfa(fresh)).toBe(true);
    expect(await storedGitHubMfa(stale)).toBe(false);
    expect(await sessionMfa(newSession)).toEqual({ mfaVerified: true, mfaMethod: 'github' });
  });

  it('checks the GitHub account whose token the sign-in stored, not one changed since without one', async () => {
    const fetchSpy = mockGitHubApi({ 'fresh-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const signedIn = await connectGitHubWithToken(jane, 'fresh-token', {
      updatedAt: new Date(Date.now() - 60_000),
    });
    // Another GitHub account, changed later (e.g. confirmed on the Security page), holds no token.
    await db.insert(account).values({
      userId: jane,
      accountId: 'github-other',
      providerId: 'github',
      updatedAt: new Date(),
    });
    const newSession = await createSession(db, jane);

    await afterAuthRequest(
      githubCallback(new Headers(), { sessionId: newSession, userId: jane }).ctx,
    );

    expect(githubApiTokens(fetchSpy)).toEqual(['Bearer fresh-token']);
    expect(await storedGitHubMfa(signedIn)).toBe(true);
    expect(await sessionMfa(newSession)).toEqual({ mfaVerified: true, mfaMethod: 'github' });
  });

  it('stores a definite answer, and confirms the sign-in only when 2FA is on', async () => {
    mockGitHubApi({ 'jane-token': false, 'john-token': true });
    // Jane turned 2FA off on GitHub since her last sign-in; John turned it on.
    const jane = await createUser(db, 'jane@adiutor.test');
    const janeGitHub = await connectGitHubWithToken(jane, 'jane-token', { mfaVerified: true });
    const janeSession = await createSession(db, jane);
    const john = await createUser(db, 'john@adiutor.test');
    const johnGitHub = await connectGitHubWithToken(john, 'john-token');
    const johnSession = await createSession(db, john);

    await afterAuthRequest(
      githubCallback(new Headers(), { sessionId: janeSession, userId: jane }).ctx,
    );
    await afterAuthRequest(
      githubCallback(new Headers(), { sessionId: johnSession, userId: john }).ctx,
    );

    expect(await storedGitHubMfa(janeGitHub)).toBe(false);
    expect(await sessionMfa(janeSession)).toEqual({ mfaVerified: false, mfaMethod: null });
    expect(await storedGitHubMfa(johnGitHub)).toBe(true);
    expect(await sessionMfa(johnSession)).toEqual({ mfaVerified: true, mfaMethod: 'github' });
  });

  it.each([
    ['GitHub is unreachable', () => Promise.reject(new TypeError('fetch failed'))],
    // E.g. rate limited or down: a failed response doesn't count, whatever its body says.
    [
      'GitHub answers with an error',
      async () => Response.json({ two_factor_authentication: false }, { status: 500 }),
    ],
    ["GitHub's answer doesn't say", async () => Response.json({ login: 'adiutor-tests' })],
  ])(
    'keeps the stored 2FA status, doesn’t confirm the session with it, and says GitHub couldn’t be checked, when %s',
    async (_, respond: () => Promise<Response>) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(respond);
      // The failure is logged; keep the test output clean.
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const jane = await createUser(db, 'jane@adiutor.test');
      const github = await connectGitHubWithToken(jane, 'jane-token', { mfaVerified: true });
      const previous = await createSession(db, jane);
      const newSession = await createSession(db, jane);
      // "Confirm with GitHub" on the step-up page, so the next page says why it didn't count.
      markReverify(jane, previous);
      const { ctx, setCookie } = githubCallback(await signedInHeaders(previous), {
        sessionId: newSession,
        userId: jane,
      });

      await afterSessionCreate({ id: newSession, userId: jane }, ctx);
      await afterAuthRequest(ctx);

      expect(await storedGitHubMfa(github)).toBe(true);
      expect(await sessionMfa(newSession)).toEqual({ mfaVerified: false, mfaMethod: null });
      // No answer isn't "2FA off", whatever an error response says.
      expect(cookiesBesidesLanguage(setCookie)).toHaveLength(1);
      expect(setCookie).toHaveBeenCalledWith(
        PROVIDER_STEP_UP_COOKIE,
        'github:unchecked',
        expect.anything(),
      );
    },
  );

  it('keeps the stored 2FA status of an account just connected when GitHub is unreachable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const jane = await createUser(db, 'jane@adiutor.test');
    const github = await connectGitHubWithToken(jane, 'jane-token', { mfaVerified: true });

    await afterAccountCreate(
      { id: github, userId: jane, providerId: 'github', confirmed: true },
      githubCallback().ctx,
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(await storedGitHubMfa(github)).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      'Checking GitHub two-factor authentication failed',
      expect.any(TypeError),
    );
    // The connection itself is still recorded.
    expect((await events()).map((event) => event.action)).toEqual(['provider_connected']);
  });
});
