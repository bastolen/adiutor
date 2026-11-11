/**
 * @file Integration tests for the checks on the request itself: sign-in links,
 * return addresses and passkey names.
 */
import { addOAuthServerContext, getSessionFromCtx } from 'better-auth/api';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '@/lib/env';

import {
  createUser,
  enableTwoFactor,
  inSequence,
  staffActor,
} from '../../../../tests/integration/helpers';
import { loadMfaContext } from '../mfa-state';
import { beforeAuthRequest } from './before-request';
import { releaseSignInChangeLockOf } from './change-lock';
import type { AuthGuardContext } from './paths';
import { request, refusedWith, hits, db, signedIn, outcomeOf } from './test-helpers';

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

describe('sign-in links', () => {
  /** A sign-in link's query, as Better Auth's link and the confirmation page send it. */
  const query = { token: 'abc', callbackURL: '/admin/users', errorCallbackURL: '/auth' };

  /**
   * Opens a sign-in link with the given browser headers.
   *
   * @param headers - `Sec-Fetch-*` headers, as a browser sends them.
   * @returns The guard's outcome: `allowed`, or where it redirects.
   */
  async function open(headers: Record<string, string>): Promise<string> {
    try {
      await beforeAuthRequest({
        ...request('/magic-link/verify'),
        query,
        headers: new Headers(headers),
      });
      return 'allowed';
    } catch (error) {
      const refusal = error as { statusCode?: number; headers?: Headers };
      expect(refusal.statusCode).toBe(302);
      return refusal.headers?.get('location') ?? 'no location';
    }
  }

  /** The confirmation page for {@link query}. */
  const confirmationPage =
    '/auth/email-link?token=abc&callbackURL=%2Fadmin%2Fusers&errorCallbackURL=%2Fauth';

  it('only sign in from the click on the confirmation page', async () => {
    expect(await open({ 'sec-fetch-site': 'same-origin', 'sec-fetch-user': '?1' })).toBe('allowed');
  });

  it('go to the confirmation page first when opened any other way in a browser', async () => {
    // From the email (typed or opened from a mail app), another site, or a script on the page.
    expect(await open({ 'sec-fetch-site': 'none', 'sec-fetch-user': '?1' })).toBe(confirmationPage);
    expect(await open({ 'sec-fetch-site': 'cross-site', 'sec-fetch-user': '?1' })).toBe(
      confirmationPage,
    );
    expect(await open({ 'sec-fetch-site': 'same-site' })).toBe(confirmationPage);
    expect(await open({ 'sec-fetch-site': 'same-origin' })).toBe(confirmationPage);
  });

  it("are left to Better Auth for requests that don't come from a browser", async () => {
    expect(await open({})).toBe('allowed');
  });
});

describe('return addresses', () => {
  /** The headers of the "Continue signing in" click, which the guard lets through to the check. */
  const CLICK = { 'sec-fetch-site': 'same-origin', 'sec-fetch-user': '?1' };

  /** Where the guard sends a link the browser opened with an unsafe return address. */
  const ERROR_PAGE = '/sign-in-error?error=UNSAFE_RETURN_ADDRESS';

  /** Each endpoint that takes return addresses, where it takes them, and which ones. */
  const ENDPOINTS = [
    ['/sign-in/magic-link', 'body', ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL']],
    ['/magic-link/verify', 'query', ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL']],
    ['/sign-in/social', 'body', ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL']],
    ['/link-social', 'body', ['callbackURL', 'errorCallbackURL']],
    ['/request-password-reset', 'body', ['redirectTo']],
    ['/verify-email', 'query', ['callbackURL']],
    ['/send-verification-email', 'body', ['callbackURL']],
  ] as const;

  /** Return addresses that aren't pages of the app: under `/api`, or another site. */
  const UNSAFE = [
    '/api/auth/magic-link/verify?token=attacker&callbackURL=/dashboard',
    '/API/auth/ok',
    '/x/../api/auth/ok',
    '/%61pi/auth/ok',
    'https://evil.adiutor.test/dashboard',
    // Absolute, even to this site.
    `${env.BETTER_AUTH_URL}/dashboard`,
    '//evil.adiutor.test',
    '/\\evil.adiutor.test',
    '',
    ['/dashboard'],
    // An anchor that names no section: a text fragment, or one Next.js can't decode.
    '/account#:~:text=secret',
    '/account#100%',
  ];

  /**
   * Sends a request with the given return addresses, where the endpoint takes them.
   *
   * @param path - The endpoint path.
   * @param where - Body or query.
   * @param fields - The return addresses (and anything else to send).
   * @returns `allowed`, the refusal's error code, or where the guard redirects.
   */
  async function outcome(
    path: string,
    where: 'body' | 'query',
    fields: Record<string, unknown>,
  ): Promise<string> {
    const ctx: AuthGuardContext = {
      ...request(path, { body: where === 'body' ? fields : {} }),
      query: where === 'query' ? { token: 'abc', ...fields } : {},
      headers: new Headers(CLICK),
    };
    try {
      await beforeAuthRequest(ctx);
    } catch (error) {
      const refusal = error as { statusCode?: number; headers?: Headers; body?: { code?: string } };
      if (refusal.statusCode === 302) {
        return refusal.headers?.get('location') ?? 'no location';
      }
      return refusal.body?.code ?? String(error);
    }
    await releaseSignInChangeLockOf({ context: ctx.context });
    return 'allowed';
  }

  it.each(ENDPOINTS)(
    '%s refuses addresses under /api and on other sites',
    async (path, where, fields) => {
      const refused = where === 'query' ? ERROR_PAGE : 'UNSAFE_RETURN_ADDRESS';
      const outcomes = await inSequence(
        fields.flatMap((field) => UNSAFE.map((value) => ({ [field]: value }))),
        (sent) => outcome(path, where, sent),
      );
      expect(outcomes).toEqual(outcomes.map(() => refused));
    },
  );

  it.each(ENDPOINTS)(
    '%s allows pages of the app, and fields left out',
    async (path, where, fields) => {
      const safe = Object.fromEntries(
        fields.map((field, index) => [
          field,
          [
            '/account?verified=1#email',
            "/auth?callbackURL=%2Fcompanies%2Fx&q=O'Brien",
            '/account#x',
          ][index],
        ]),
      );
      expect(await outcome(path, where, safe)).toBe('allowed');
      expect(await outcome(path, where, {})).toBe('allowed');
      expect(
        await outcome(path, where, Object.fromEntries(fields.map((field) => [field, undefined]))),
      ).toBe('allowed');
    },
  );

  it('sends a sign-in link opened outside the app to the confirmation page before checking', async () => {
    const chained = '/api/auth/magic-link/verify?token=attacker&callbackURL=/dashboard';
    let location: string | null = null;
    try {
      await beforeAuthRequest({
        ...request('/magic-link/verify'),
        query: { token: 'abc', callbackURL: chained },
        headers: new Headers({ 'sec-fetch-site': 'none', 'sec-fetch-user': '?1' }),
      });
    } catch (error) {
      location = (error as { headers?: Headers }).headers?.get('location') ?? null;
    }
    // The page passes only safe return addresses on (`getSafeRedirectPath`).
    expect(location).toBe(
      `/auth/email-link?${new URLSearchParams({ token: 'abc', callbackURL: chained })}`,
    );
  });

  it('refuses a request that comes without browser headers too', async () => {
    await expect(
      beforeAuthRequest({
        ...request('/magic-link/verify'),
        query: { token: 'abc', callbackURL: UNSAFE[0] },
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ statusCode: 302 });
  });

  it("refuses before counting an email towards the address's limit", async () => {
    await expect(
      beforeAuthRequest(
        request('/sign-in/magic-link', {
          body: { email: 'jane@adiutor.test', callbackURL: UNSAFE[0] },
        }),
      ),
    ).rejects.toEqual(refusedWith('UNSAFE_RETURN_ADDRESS'));
    await expect(
      beforeAuthRequest(
        request('/request-password-reset', {
          body: { email: 'jane@adiutor.test', redirectTo: UNSAFE[0] },
        }),
      ),
    ).rejects.toEqual(refusedWith('UNSAFE_RETURN_ADDRESS'));

    expect(await hits('/sign-in/magic-link:email:jane@adiutor.test')).toBeNull();
    expect(await hits('/request-password-reset:email:jane@adiutor.test')).toBeNull();
  });

  it("refuses connecting a provider before taking the user's lock", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await signedIn(jane);

    expect(await outcomeOf('/link-social', { provider: 'github', callbackURL: UNSAFE[0] })).toBe(
      'UNSAFE_RETURN_ADDRESS',
    );
    expect(await outcomeOf('/link-social', { provider: 'github', callbackURL: '/account' })).toBe(
      'allowed',
    );
  });
});

describe('passkey names', () => {
  /** The endpoints that take a passkey's name, and where. */
  const NAME_FIELDS = [
    ['/passkey/generate-register-options', 'query'],
    ['/passkey/verify-registration', 'body'],
    ['/passkey/update-passkey', 'body'],
  ] as const;

  /** Names the guards refuse: empty, too long, a line break, hidden text, not a string. */
  const REFUSED = [
    '',
    '   ',
    'a'.repeat(65),
    'Work\nlaptop',
    'Work \u{202E}potpal',
    'Work\u{200B} laptop',
    'Work \u{2066}laptop\u{2069}',
    'Work\u{FEFF} laptop',
    42,
  ];

  /**
   * Sends a request with a passkey name, where the endpoint takes it.
   *
   * @param path - The endpoint path.
   * @param where - Body or query.
   * @param name - The name, or `undefined` to send none.
   * @returns `allowed`, or the refusal's error code.
   */
  async function outcomeWithName(
    path: string,
    where: 'body' | 'query',
    name: unknown,
  ): Promise<string> {
    const fields = name === undefined ? {} : { name };
    const ctx: AuthGuardContext = {
      ...request(path, { body: where === 'body' ? fields : {} }),
      query: where === 'query' ? fields : {},
    };
    try {
      await beforeAuthRequest(ctx);
    } catch (error) {
      return (error as { body?: { code?: string } }).body?.code ?? String(error);
    }
    await releaseSignInChangeLockOf({ context: ctx.context });
    return 'allowed';
  }

  it.each(NAME_FIELDS)(
    '%s takes names of up to 64 characters without hidden text',
    async (path, where) => {
      const newcomer = await createUser(db, 'newcomer@adiutor.test');
      await signedIn(newcomer);

      expect(await outcomeWithName(path, where, 'Work laptop')).toBe('allowed');
      expect(await outcomeWithName(path, where, ` ${'a'.repeat(64)} `)).toBe('allowed');
      expect(await outcomeWithName(path, where, '\u{915}\u{94D}\u{200D}\u{937} laptop')).toBe(
        'allowed',
      );
      expect(await inSequence(REFUSED, (name) => outcomeWithName(path, where, name))).toEqual(
        REFUSED.map(() => 'INVALID_PASSKEY_NAME'),
      );
    },
  );

  it('leaves a request without a name to Better Auth', async () => {
    const newcomer = await createUser(db, 'newcomer@adiutor.test');
    await signedIn(newcomer);

    expect(
      await inSequence(NAME_FIELDS, ([path, where]) => outcomeWithName(path, where, undefined)),
    ).toEqual(NAME_FIELDS.map(() => 'allowed'));
    expect(await outcomeWithName('/passkey/verify-registration', 'body', null)).toBe('allowed');
  });

  it('refuses a name before reading the session or the MFA state', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    await signedIn(support.id);
    vi.mocked(getSessionFromCtx).mockClear();
    vi.mocked(loadMfaContext).mockClear();

    expect(await outcomeWithName('/passkey/update-passkey', 'body', 'a'.repeat(65))).toBe(
      'INVALID_PASSKEY_NAME',
    );
    expect(getSessionFromCtx).not.toHaveBeenCalled();
    expect(loadMfaContext).not.toHaveBeenCalled();
    // A good name goes on to the usual checks.
    expect(await outcomeWithName('/passkey/update-passkey', 'body', 'Work laptop')).toBe(
      'MFA_VERIFICATION_REQUIRED',
    );
  });
});
