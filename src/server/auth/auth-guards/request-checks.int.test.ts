/**
 * @file Integration tests for the checks on the request itself: sign-in links
 * (only their confirmation page's Continue signs in, also through Better
 * Auth's whole handler), return addresses and passkey names.
 */
import { addOAuthServerContext, getSessionFromCtx } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { session, verification } from '@/db/schema';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import {
  ACTING_AS_CHANGED_COOKIE,
  LAST_USED_LOGIN_METHOD_COOKIE,
} from '@/lib/sign-in/auth-cookies';
import { emailLinkVerificationIdentifier } from '@/lib/sign-in/tokens';

import {
  createUser,
  enableTwoFactor,
  inSequence,
  staffActor,
  storeSignInLink,
  auditEvents,
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

/** The site's origin, which a form `POST` from its pages names (`Origin`). */
const SITE_ORIGIN = new URL(env.BETTER_AUTH_URL).origin;

/**
 * A page load that a page of the site started: the headers of the "Continue
 * signing in" on a sign-in link's confirmation page, also in Safari, which
 * never sends `Sec-Fetch-User`.
 */
const PAGE_LOAD = {
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  origin: SITE_ORIGIN,
};

/** A click on a link on a page of the site, such as one written in a request's text. */
const SAME_ORIGIN_CLICK = { ...PAGE_LOAD, 'sec-fetch-user': '?1' };

describe('sign-in links', () => {
  /** A sign-in link's fields, as Better Auth's link and the confirmation page send them. */
  const fields = { token: 'abc', callbackURL: '/admin/users', errorCallbackURL: '/auth' };

  /**
   * Sends a sign-in link to the guard: opened (`GET`, the fields in its query)
   * or posted (`POST`, in its form, as the confirmation page's Continue).
   *
   * @param method - `GET` or `POST`.
   * @param headers - The browser's headers.
   * @returns The guard's outcome: `allowed`, or where it redirects.
   */
  async function send(method: 'GET' | 'POST', headers: Record<string, string>): Promise<string> {
    try {
      await beforeAuthRequest({
        ...request('/magic-link/verify', { body: method === 'POST' ? fields : {} }),
        method,
        query: method === 'GET' ? fields : {},
        headers: new Headers(headers),
      });
      return 'allowed';
    } catch (error) {
      const refusal = error as { statusCode?: number; headers?: Headers };
      // A form's POST gets a 303, so the browser opens the page with a GET.
      expect(refusal.statusCode).toBe(method === 'POST' ? 303 : 302);
      return refusal.headers?.get('location') ?? 'no location';
    }
  }

  /** The confirmation page for {@link fields}. */
  const confirmationPage =
    '/auth/email-link?token=abc&callbackURL=%2Fadmin%2Fusers&errorCallbackURL=%2Fauth';

  it("only sign in with the confirmation page's Continue, also where the browser never says a person clicked", async () => {
    // Safari, and every browser on an iPhone: no `Sec-Fetch-User`.
    expect(await send('POST', PAGE_LOAD)).toBe('allowed');
    expect(await send('POST', SAME_ORIGIN_CLICK)).toBe('allowed');
    // Safari before 16.4: no Fetch Metadata at all, but the site's exact origin.
    expect(await send('POST', { origin: SITE_ORIGIN })).toBe('allowed');
  });

  it.each([
    ["with Safari's headers (no click header)", PAGE_LOAD],
    ['without Fetch Metadata (Safari before 16.4, a program that is no browser)', {}],
    ["with only the site's origin", { origin: SITE_ORIGIN }],
    ['clicked on a page of the site, as a link in a reply is', SAME_ORIGIN_CLICK],
    ['from an email or typed in', { 'sec-fetch-site': 'none', 'sec-fetch-user': '?1' }],
    ['from another site', { 'sec-fetch-site': 'cross-site', 'sec-fetch-user': '?1' }],
    ['from a sister site', { 'sec-fetch-site': 'same-site' }],
  ])('go to the confirmation page first when opened (GET) %s', async (_case, headers) => {
    expect(await send('GET', headers)).toBe(confirmationPage);
  });

  it.each([
    ["from another site's form", { ...SAME_ORIGIN_CLICK, 'sec-fetch-site': 'cross-site' }],
    ['without Fetch Metadata or an origin', {}],
    ['from another origin, without Fetch Metadata', { origin: 'https://mail.adiutor.test' }],
    ['with an origin of null, without Fetch Metadata', { origin: 'null' }],
    [
      'with only a referrer from the page, without Fetch Metadata',
      { referer: `${SITE_ORIGIN}/auth/email-link` },
    ],
    [
      "from the site's own script, not a page load",
      { ...PAGE_LOAD, 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
    ],
    ['in a frame', { ...PAGE_LOAD, 'sec-fetch-dest': 'iframe' }],
    ['typed in', { ...PAGE_LOAD, 'sec-fetch-site': 'none' }],
  ])(
    "send a POST that isn't the page's own back to the page, unused (%s)",
    async (_case, headers) => {
      expect(await send('POST', headers)).toBe(confirmationPage);
    },
  );
});

describe("a sign-in link used through Better Auth's handler", () => {
  /** The account the link signs in to. */
  const JANE = 'jane@adiutor.test';

  /**
   * Opens (`GET`) or posts (`POST`, the confirmation page's form) a sign-in
   * link through Better Auth's whole handler, guards and reactions included.
   *
   * @param method - `GET` or `POST`.
   * @param token - The link's token.
   * @param headers - The browser's headers.
   * @returns The response.
   */
  function useLink(
    method: 'GET' | 'POST',
    token: string,
    headers: Record<string, string>,
  ): Promise<Response> {
    const link = new URLSearchParams({ token, callbackURL: '/admin/users' });
    const verify = `${env.BETTER_AUTH_URL}/api/auth/magic-link/verify`;
    return auth.handler(
      method === 'POST'
        ? new Request(verify, {
            method,
            headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
            body: link,
          })
        : new Request(`${verify}?${link}`, { headers }),
    );
  }

  /**
   * Whether a response sets a session cookie.
   *
   * @param response - The response.
   * @returns Whether it does.
   */
  function setsSession(response: Response): boolean {
    return response.headers.getSetCookie().some((cookie) => cookie.includes('session_token='));
  }

  /**
   * Counts a user's sessions.
   *
   * @param userId - The user.
   * @returns How many they have.
   */
  async function sessionsOf(userId: string): Promise<number> {
    return (await db.select({ id: session.id }).from(session).where(eq(session.userId, userId)))
      .length;
  }

  /**
   * Whether a link is still stored, unused.
   *
   * @param token - The link's token.
   * @returns Whether it is.
   */
  async function unused(token: string): Promise<boolean> {
    const rows = await db
      .select({ id: verification.id })
      .from(verification)
      .where(eq(verification.identifier, emailLinkVerificationIdentifier(token)));
    return rows.length === 1;
  }

  it.each([
    ["Safari's", PAGE_LOAD],
    ['a click header too, as other browsers send', SAME_ORIGIN_CLICK],
    ["only the site's origin, as Safari before 16.4 sends", { origin: SITE_ORIGIN }],
  ])("signs in with the page's Continue, with %s headers", async (_case, headers) => {
    const jane = await createUser(db, JANE);
    const token = await storeSignInLink(db, JANE);

    const response = await useLink('POST', token, headers);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${env.BETTER_AUTH_URL}/admin/users`);
    expect(setsSession(response)).toBe(true);
    expect(await sessionsOf(jane)).toBe(1);
    expect(await unused(token)).toBe(false);
  });

  it('signs in as the link always did: recorded and remembered as one, other tabs told, and the account it switches from signed out here', async () => {
    const alex = await createUser(db, 'alex@adiutor.test');
    const jane = await createUser(db, JANE);
    // Alex signed in in this browser first, with a link of their own.
    const first = await useLink('POST', await storeSignInLink(db, 'alex@adiutor.test'), PAGE_LOAD);
    const alexCookies = first.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

    const response = await useLink('POST', await storeSignInLink(db, JANE), {
      ...PAGE_LOAD,
      cookie: alexCookies,
    });

    expect(response.status).toBe(303);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toContainEqual(
      expect.stringMatching(new RegExp(`^${LAST_USED_LOGIN_METHOD_COOKIE}=magic-link;`)),
    );
    expect(cookies).toContainEqual(
      expect.stringMatching(new RegExp(`^${ACTING_AS_CHANGED_COOKIE}=1;`)),
    );
    expect(await sessionsOf(alex)).toBe(0);
    expect(await sessionsOf(jane)).toBe(1);
    expect(await auditEvents(db, { actorUserId: jane, fields: ['action', 'details'] })).toEqual([
      { action: 'sign_in', details: { method: 'email_link' } },
    ]);
  });

  it.each([
    ["with Safari's headers", PAGE_LOAD],
    ['without Fetch Metadata', {}],
    ['clicked on a page of the site, as a link in a reply is', SAME_ORIGIN_CLICK],
  ])(
    'opens the confirmation page for a link opened %s, without a session',
    async (_case, headers) => {
      const jane = await createUser(db, JANE);
      const token = await storeSignInLink(db, JANE);

      const response = await useLink('GET', token, headers);

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(
        `/auth/email-link?${new URLSearchParams({ token, callbackURL: '/admin/users' })}`,
      );
      expect(setsSession(response)).toBe(false);
      expect(await sessionsOf(jane)).toBe(0);
      expect(await unused(token)).toBe(true);
    },
  );

  it.each([
    ["from another site's form", { ...SAME_ORIGIN_CLICK, 'sec-fetch-site': 'cross-site' }],
    ['without Fetch Metadata or an origin', {}],
  ])('refuses a POST %s: back to the page, without a session', async (_case, headers) => {
    const jane = await createUser(db, JANE);
    const token = await storeSignInLink(db, JANE);

    const response = await useLink('POST', token, headers);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `/auth/email-link?${new URLSearchParams({ token, callbackURL: '/admin/users' })}`,
    );
    expect(setsSession(response)).toBe(false);
    expect(await sessionsOf(jane)).toBe(0);
    expect(await unused(token)).toBe(true);
  });
});

describe('return addresses', () => {
  /** Where the guard sends a link the browser opened with an unsafe return address. */
  const ERROR_PAGE = '/sign-in-error?error=UNSAFE_RETURN_ADDRESS';

  /**
   * Each endpoint that takes return addresses, where it takes them (a `form`
   * is the body of the confirmation page's Continue), and which ones.
   */
  const ENDPOINTS = [
    ['/sign-in/magic-link', 'body', ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL']],
    ['/magic-link/verify', 'form', ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL']],
    ['/sign-in/social', 'body', ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL']],
    ['/link-social', 'body', ['callbackURL', 'errorCallbackURL']],
    ['/request-password-reset', 'body', ['redirectTo']],
    ['/reset-password/:token', 'query', ['callbackURL']],
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
   * Sends a request with the given return addresses, where the endpoint takes
   * them, with the headers of a page load the site's page started (which a
   * sign-in link's Continue needs to get to the check).
   *
   * @param path - The endpoint path.
   * @param where - Body, query, or the body of the confirmation page's form (`POST`).
   * @param fields - The return addresses (and anything else to send).
   * @returns `allowed`, the refusal's error code, or where the guard redirects.
   */
  async function outcome(
    path: string,
    where: 'body' | 'query' | 'form',
    fields: Record<string, unknown>,
  ): Promise<string> {
    const ctx: AuthGuardContext = {
      ...request(path, {
        body: where === 'query' ? {} : { ...(where === 'form' && { token: 'abc' }), ...fields },
      }),
      method: where === 'query' ? 'GET' : 'POST',
      query: where === 'query' ? { token: 'abc', ...fields } : {},
      headers: new Headers(SAME_ORIGIN_CLICK),
    };
    try {
      await beforeAuthRequest(ctx);
    } catch (error) {
      const refusal = error as { statusCode?: number; headers?: Headers; body?: { code?: string } };
      // A link's redirect is a 302, a form's a 303.
      if (refusal.statusCode === (where === 'form' ? 303 : 302)) {
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
      const refused = where === 'body' ? 'UNSAFE_RETURN_ADDRESS' : ERROR_PAGE;
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

  it.each([
    ['opened outside the app', { 'sec-fetch-site': 'none', 'sec-fetch-user': '?1' }],
    ['opened without browser headers', {}],
    ['clicked on a page of the site', SAME_ORIGIN_CLICK],
  ])('sends a sign-in link %s to the confirmation page before checking', async (_case, headers) => {
    const chained = '/api/auth/magic-link/verify?token=attacker&callbackURL=/dashboard';
    let location: string | null = null;
    try {
      await beforeAuthRequest({
        ...request('/magic-link/verify'),
        method: 'GET',
        query: { token: 'abc', callbackURL: chained },
        headers: new Headers(headers),
      });
    } catch (error) {
      location = (error as { headers?: Headers }).headers?.get('location') ?? null;
    }
    // The page passes only safe return addresses on (`getSafeRedirectPath`).
    expect(location).toBe(
      `/auth/email-link?${new URLSearchParams({ token: 'abc', callbackURL: chained })}`,
    );
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
