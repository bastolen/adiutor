/**
 * @file Integration tests for naming provider accounts from the provider's
 * profile.
 */
import { getOAuthState } from 'better-auth/api';
import { afterEach, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
import { sendEmail } from '@/lib/email';
import { LAST_USED_LOGIN_METHOD_COOKIE } from '@/lib/sign-in/auth-cookies';
import { PROVIDER_LINKED_COOKIE } from '@/lib/sign-in/oauth-providers';

import { afterAuthRequest } from './after-request';
import type { AuthHookContext } from './hook-context';
import {
  afterAccountCreate,
  beforeAccountCreate,
  beforeAccountUpdate,
  noteProviderAccountName,
} from './provider-accounts';
import {
  db,
  githubCallback,
  mockGitHubApi,
  connectGitHubWithToken,
  events,
  subjects,
} from './test-helpers';
import { createSession, createUser } from '../../../../tests/integration/helpers';
import { releaseSignInChangeLockOf } from '../auth-guards';

vi.mock('@/db', async (importOriginal) =>
  (await import('../../../../tests/integration/app-modules')).default(await importOriginal()),
);

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

describe('naming a provider account', () => {
  /**
   * The source Better Auth hands `validateUserInfo` for a GitHub sign-in or
   * connection.
   *
   * @param profile - GitHub's profile (its `/user` response).
   * @returns The source.
   */
  const githubSource = (profile: Record<string, unknown>) => ({
    method: 'oauth',
    oauth: { providerId: 'github', profile },
  });

  /**
   * The same request as `ctx` as Better Auth hands it to another hook: a
   * different object sharing its `context`.
   *
   * @param ctx - The request.
   * @returns Another context of that request.
   */
  const sameRequest = (ctx: AuthHookContext): AuthHookContext => ({ ...ctx });

  it('stores the name from the profile when the account is created', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const { ctx } = githubCallback();
    noteProviderAccountName(githubSource({ id: 1, login: 'adiutor-tests' }), sameRequest(ctx));

    const result = await beforeAccountCreate(
      { userId: jane, providerId: 'github', accountId: '1' },
      ctx,
    );
    await releaseSignInChangeLockOf({ context: ctx.context });

    expect(result.data).toMatchObject({ accountName: 'adiutor-tests' });
  });

  it('refreshes the name when signing in again, next to dropping the tokens', () => {
    const { ctx } = githubCallback();
    noteProviderAccountName(githubSource({ login: 'adiutor-tests-renamed' }), sameRequest(ctx));

    const { data } = beforeAccountUpdate(
      { providerId: 'github', accessToken: 'token', idToken: 'id-token' },
      ctx,
    );

    expect(data).toEqual({
      providerId: 'github',
      accessToken: 'token',
      idToken: null,
      refreshToken: null,
      accountName: 'adiutor-tests-renamed',
    });
  });

  it('only names an account of the same provider, in the same request, once', () => {
    const { ctx } = githubCallback();
    noteProviderAccountName(githubSource({ login: 'adiutor-tests' }), ctx);

    expect(beforeAccountUpdate({ providerId: 'google' }, ctx).data).not.toHaveProperty(
      'accountName',
    );
    expect(
      beforeAccountUpdate({ providerId: 'github' }, githubCallback().ctx).data,
    ).not.toHaveProperty('accountName');
    expect(beforeAccountUpdate({ providerId: 'github' }, ctx).data).toHaveProperty('accountName');
    expect(beforeAccountUpdate({ providerId: 'github' }, ctx).data).not.toHaveProperty(
      'accountName',
    );
  });

  it('keeps the stored name when the profile has none', async () => {
    const { ctx } = githubCallback();
    noteProviderAccountName(githubSource({ login: 'adiutor-tests' }), ctx);
    // A later sign-in in that request whose profile has no username.
    noteProviderAccountName(githubSource({ id: 1 }), ctx);

    expect(beforeAccountUpdate({ providerId: 'github' }, ctx).data).not.toHaveProperty(
      'accountName',
    );
    expect(beforeAccountUpdate({ providerId: 'github' }, null).data).not.toHaveProperty(
      'accountName',
    );
  });

  it('never throws, whatever the profile, so it never refuses a sign-in', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx } = githubCallback();
    const hostile = {};
    Object.defineProperty(hostile, 'login', {
      enumerable: true,
      /**
       * A claim that fails when read.
       *
       * @throws {Error} Always.
       */
      get: () => {
        throw new Error('adiutor-tests secret profile');
      },
    });

    expect(() => noteProviderAccountName(githubSource(hostile), ctx)).not.toThrow();
    expect(() => noteProviderAccountName(githubSource({ login: 'x' }), null)).not.toThrow();
    expect(() => noteProviderAccountName({ method: 'magic-link' }, ctx)).not.toThrow();
    expect(() =>
      noteProviderAccountName({ method: 'oauth', oauth: { providerId: 'gitlab' } }, ctx),
    ).not.toThrow();

    expect(beforeAccountUpdate({ providerId: 'github' }, ctx).data).not.toHaveProperty(
      'accountName',
    );
    // What failed, never the profile.
    expect(errors.mock.calls.flat().join(' ')).not.toContain('secret');
  });

  it('names the account in the next-page notice after connecting it at sign-in', async () => {
    mockGitHubApi({});
    const john = await createUser(db, 'john@adiutor.test');
    const github = await connectGitHubWithToken(john, 'john-token');
    const { ctx, setCookie } = githubCallback();

    await afterAccountCreate(
      {
        id: github,
        userId: john,
        providerId: 'github',
        confirmed: true,
        accountName: 'adiutor-tests',
      },
      ctx,
    );

    expect(setCookie).toHaveBeenCalledWith(
      PROVIDER_LINKED_COOKIE,
      'github:adiutor-tests',
      expect.anything(),
    );
    // The audit event and the email don't carry the name.
    expect((await events()).map((event) => event.details)).toEqual([
      { providerId: 'github', atSignIn: true, confirmed: true },
    ]);
    expect(subjects()).toEqual(['GitHub was connected to your Adiutor account']);
  });

  describe('the next-page notice naming the account', () => {
    /**
     * Request headers of a browser that still has the notice's cookie.
     *
     * @returns The headers.
     */
    const withNoticeCookie = () =>
      new Headers({ cookie: `${PROVIDER_LINKED_COOKIE}=github%3Aadiutor-tests` });

    /**
     * Checks whether a request removed the notice's cookie.
     *
     * @param setCookie - The request's `setCookie` mock.
     * @returns Whether it set the cookie to expire.
     */
    const cleared = (setCookie: ReturnType<typeof githubCallback>['setCookie']) =>
      setCookie.mock.calls.some(
        ([name, value, options]) =>
          name === PROVIDER_LINKED_COOKIE && value === '' && options?.maxAge === 0,
      );

    it('is removed when someone signs out, with every other cookie but the last sign-in method', async () => {
      const headers = new Headers({
        cookie: [
          `${PROVIDER_LINKED_COOKIE}=github%3Aadiutor-tests`,
          '__Secure-better-auth.trust_device=adiutor-tests-device',
          `${LAST_USED_LOGIN_METHOD_COOKIE}=github`,
          'adiutor-tests-other=1',
        ].join('; '),
      });
      const { ctx, setCookie } = githubCallback(headers);

      await afterAuthRequest({ ...ctx, path: '/sign-out', context: { session: null } });

      const expired = setCookie.mock.calls.filter(
        ([, value, options]) => value === '' && options?.maxAge === 0,
      );
      expect(expired.map(([name]) => name)).toEqual([
        PROVIDER_LINKED_COOKIE,
        '__Secure-better-auth.trust_device',
        'adiutor-tests-other',
      ]);
      // A `__Secure-` cookie can only be changed by a secure response.
      expect(defined(expired[1], 'the secure cookie')[2]).toMatchObject({
        secure: true,
        path: '/',
      });
    });

    it('is removed when anyone signs in on the browser without connecting an account', async () => {
      mockGitHubApi({});
      const john = await createUser(db, 'john@adiutor.test');
      const sessionId = await createSession(db, john);
      const { ctx, setCookie } = githubCallback(withNoticeCookie(), { sessionId, userId: john });

      await afterAuthRequest(ctx);

      expect(cleared(setCookie)).toBe(true);
    });

    it('stays in the request that connected the account and signed in', async () => {
      mockGitHubApi({});
      const john = await createUser(db, 'john@adiutor.test');
      const github = await connectGitHubWithToken(john, 'john-token');
      const sessionId = await createSession(db, john);
      // An older notice's cookie is still there; this request replaces it.
      const { ctx, setCookie } = githubCallback(withNoticeCookie(), { sessionId, userId: john });

      await afterAccountCreate(
        { id: github, userId: john, providerId: 'github', confirmed: true, accountName: 'john' },
        ctx,
      );
      await afterAuthRequest({ ...ctx, context: ctx.context });

      expect(setCookie).toHaveBeenCalledWith(
        PROVIDER_LINKED_COOKIE,
        'github:john',
        expect.anything(),
      );
      expect(cleared(setCookie)).toBe(false);
    });

    it('leaves browsers without it alone', async () => {
      const { ctx, setCookie } = githubCallback();

      await afterAuthRequest({ ...ctx, path: '/sign-out', context: { session: null } });

      expect(setCookie).not.toHaveBeenCalled();
    });
  });
});
