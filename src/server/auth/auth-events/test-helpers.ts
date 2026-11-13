/**
 * @file Sessions, signed cookies, provider callbacks and trusted devices shared
 * by the integration tests of the reactions to Better Auth activity.
 */
import { createHmac } from 'node:crypto';

import { getOAuthState } from 'better-auth/api';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { expect, vi } from 'vitest';

import { account, auditEvent, session, user, verification } from '@/db/schema';
import type { MfaMethod } from '@/lib/authz/mfa';
import { firstRow } from '@/lib/defined';
import { sendEmail } from '@/lib/email';
import { LOCALE_COOKIE } from '@/lib/i18n/locales';
import { ACTING_AS_CHANGED_COOKIE } from '@/lib/sign-in/auth-cookies';

import {
  addPasskey as addStoredPasskey,
  connectProvider,
  minutesAgo,
  sendQueuedEmails,
  setupTestContext,
} from '../../../../tests/integration/helpers';
import type { AuthHookContext } from './hook-context';

/**
 * The test database context these tests share. Each test file imports this
 * module afresh (Vitest isolates test files), so each gets its own context
 * and hooks, as when it called `setupTestContext()` itself.
 */
export const { ctx: services, db } = setupTestContext();

/** The session cookie's name in these tests (the hooks read it from Better Auth's context). */
export const SESSION_COOKIE = 'adiutor-tests.session_token';

/** The trusted-device cookie's name in the tests, as `createAuthCookie` gives it. */
export const TRUST_DEVICE_COOKIE = 'adiutor-tests.trust_device';

/**
 * Makes the OAuth sign-in of the next requests a re-verify ("Confirm with
 * GitHub" on the step-up page), as `markReverify` leaves it in the OAuth
 * state's `serverContext` for the callback.
 *
 * @param userId - The user who started it.
 * @param sessionId - The browser's session it confirms.
 */
export function markReverify(userId: string, sessionId: string): void {
  vi.mocked(getOAuthState).mockResolvedValue({
    callbackURL: '/dashboard',
    codeVerifier: 'adiutor-tests-code-verifier',
    expiresAt: Date.now() + 600_000,
    serverContext: { reverify: { userId, sessionId } },
  });
}

/**
 * Reads the audit log, oldest first.
 *
 * @returns The events' recorded fields.
 */
export async function events() {
  return db
    .select({
      action: auditEvent.action,
      actorUserId: auditEvent.actorUserId,
      targetUserId: auditEvent.targetUserId,
      details: auditEvent.details,
    })
    .from(auditEvent)
    .orderBy(asc(auditEvent.id));
}

/**
 * Reads whether a session still exists.
 *
 * @param sessionId - The session.
 * @returns Whether it's there.
 */
export async function sessionExists(sessionId: string): Promise<boolean> {
  const found = await db.select({ id: session.id }).from(session).where(eq(session.id, sessionId));
  return found.length > 0;
}

/**
 * Sends the security emails that wait in the queue (as the next tick would),
 * through the mocked `sendEmail` the hooks would use.
 */
export async function sendQueuedNotices(): Promise<void> {
  await sendQueuedEmails({ ...services, sendEmail });
}

/**
 * The subjects of the security emails sent, once the queued ones are sent.
 *
 * @returns The subjects, in order.
 */
export async function subjects(): Promise<string[]> {
  await sendQueuedNotices();
  return vi.mocked(sendEmail).mock.calls.map(([email]) => email.subject);
}

/**
 * Builds the context of a request made with a session, after Better Auth
 * handled it.
 *
 * @param path - The endpoint path.
 * @param signedIn - The session.
 * @param signedIn.sessionId - Its ID.
 * @param signedIn.userId - Its user.
 * @param returned - The endpoint's response or error.
 * @returns The context.
 */
export async function requestWithSession(
  path: string,
  signedIn: { sessionId: string; userId: string },
  returned: unknown = { status: true },
): Promise<AuthHookContext> {
  const found = firstRow(
    await db
      .select({ twoFactorEnabled: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, signedIn.userId)),
    'the user',
  );
  return {
    path,
    headers: new Headers(),
    body: {},
    context: {
      returned,
      session: {
        session: { id: signedIn.sessionId, mfaVerified: false, mfaMethod: null },
        user: { id: signedIn.userId, twoFactorEnabled: found.twoFactorEnabled },
      },
    },
  };
}

/**
 * Reads a session's MFA facts.
 *
 * @param sessionId - The session.
 * @returns Whether it's confirmed, and how.
 */
export async function sessionMfa(sessionId: string) {
  const [found] = await db
    .select({ mfaVerified: session.mfaVerified, mfaMethod: session.mfaMethod })
    .from(session)
    .where(eq(session.id, sessionId));
  return found;
}

/**
 * Reads when a session's second factor was proven, which starts its window
 * for changing sign-in methods (`mfaConfirmedUntil`).
 *
 * @param sessionId - The session.
 * @returns The stored `mfaVerifiedAt`.
 */
export async function sessionVerifiedAt(sessionId: string): Promise<Date | null> {
  const found = firstRow(
    await db
      .select({ mfaVerifiedAt: session.mfaVerifiedAt })
      .from(session)
      .where(eq(session.id, sessionId)),
    'the session',
  );
  return found.mfaVerifiedAt;
}

/**
 * Checks that a value is a time between `start` and now: set by the step
 * the test just ran.
 *
 * @param value - The value to check.
 * @param start - When the step started.
 */
export function expectSetSince(value: unknown, start: Date): void {
  expect(value).toBeInstanceOf(Date);
  expect((value as Date).getTime()).toBeGreaterThanOrEqual(start.getTime());
  expect((value as Date).getTime()).toBeLessThanOrEqual(Date.now());
}

/**
 * Stores a session as having had a second factor, as `beforeSessionCreate`
 * or a step-up would have.
 *
 * @param sessionId - The session.
 * @param mfaMethod - Which second factor.
 * @param verifiedAt - When it was proven; defaults to now (a sign-in or step-up just now).
 */
export async function storeSessionMfa(
  sessionId: string,
  mfaMethod: MfaMethod,
  verifiedAt = new Date(),
): Promise<void> {
  await db
    .update(session)
    .set({ mfaVerified: true, mfaMethod, mfaVerifiedAt: verifiedAt })
    .where(eq(session.id, sessionId));
}

/** The time a number of minutes ago (shared with the other integration tests). */
export { minutesAgo };

/** The secret the test requests' cookies are signed with. */
export const COOKIE_SECRET = 'adiutor-tests-cookie-secret';

/**
 * Signs a cookie value as Better Auth does: an HMAC-SHA256 of the value with
 * the secret, base64-encoded, after a dot.
 *
 * @param value - The value.
 * @param secret - The secret.
 * @returns `value.signature`.
 */
function signCookieValue(value: string, secret = COOKIE_SECRET): string {
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64')}`;
}

/**
 * Reads a signed cookie from request headers, as Better Auth's endpoint
 * context does.
 *
 * @param headers - The request headers.
 * @returns `getSignedCookie` for a hook context.
 */
export function signedCookieReader(headers: Headers) {
  return async (name: string, secret: string): Promise<string | null | false> => {
    const cookie = headers
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`));
    if (!cookie) {
      return null;
    }
    const signed = decodeURIComponent(cookie.slice(name.length + 1));
    const value = signed.slice(0, signed.lastIndexOf('.'));
    return signed === signCookieValue(value, secret) ? value : false;
  };
}

/**
 * Builds the headers of a browser signed in with a session: its signed,
 * URL-encoded session cookie (`token.signature`) among other cookies.
 *
 * @param sessionId - The session.
 * @param secret - The secret it's signed with; another one forges it.
 * @returns The request headers.
 */
export async function signedInHeaders(sessionId: string, secret = COOKIE_SECRET): Promise<Headers> {
  const found = firstRow(
    await db.select({ token: session.token }).from(session).where(eq(session.id, sessionId)),
    'the session',
  );
  const value = encodeURIComponent(signCookieValue(found.token, secret));
  return new Headers({ cookie: `theme=dark; ${SESSION_COOKIE}=${value}` });
}

/**
 * Builds the context of a GitHub OAuth callback: signing in with GitHub, or
 * connecting it from the Security page when the headers carry a session
 * cookie. `setCookie` records the cookies the hooks set.
 *
 * @param headers - Request headers; without a session cookie by default.
 * @param newSession - The session the callback created, if any.
 * @param newSession.sessionId - Its ID.
 * @param newSession.userId - Its user.
 * @returns The context and its `setCookie` mock.
 */
export function githubCallback(
  headers = new Headers(),
  newSession?: { sessionId: string; userId: string },
) {
  const setCookie = vi.fn<NonNullable<AuthHookContext['setCookie']>>();
  const ctx: AuthHookContext = {
    path: '/callback/:id',
    params: { id: 'github' },
    headers,
    setCookie,
    getSignedCookie: signedCookieReader(headers),
    context: {
      authCookies: { sessionToken: { name: SESSION_COOKIE } },
      /**
       * Gives a Better Auth cookie its name in the tests.
       *
       * @param name - The cookie, e.g. `trust_device`.
       * @returns Its name, with the tests' prefix.
       */
      createAuthCookie: (name) => ({ name: `adiutor-tests.${name}` }),
      secret: COOKIE_SECRET,
      session: null,
      newSession: newSession && {
        session: { id: newSession.sessionId },
        user: { id: newSession.userId, twoFactorEnabled: false },
      },
    },
  };
  return { ctx, setCookie };
}

/**
 * The cookies a request set to tell the next page something of its own: all
 * but the language cookie, which every sign-in sets from the account's
 * language (`rememberLanguage`), and the one that tells the other tabs, which
 * every provider sign-in sets when the browser acts as someone else now
 * (`ACTING_AS_CHANGED_COOKIE`). For tests about the other cookies.
 *
 * @param setCookie - The request's `setCookie` mock.
 * @returns The other `setCookie` calls, in order.
 */
export function noticeCookies(setCookie: ReturnType<typeof githubCallback>['setCookie']) {
  return setCookie.mock.calls.filter(
    ([name]) => name !== LOCALE_COOKIE && name !== ACTING_AS_CHANGED_COOKIE,
  );
}

/**
 * Connects a GitHub account with an access token, as Better Auth stores it
 * after the OAuth flow.
 *
 * @param userId - The user.
 * @param accessToken - The account's GitHub access token.
 * @param options - Optional details.
 * @param options.confirmed - Whether it counts yet; defaults to `true`.
 * @param options.updatedAt - When it was last used to sign in; defaults to now.
 * @param options.mfaVerified - Whether it's stored as having 2FA (from an earlier check);
 *   defaults to `false`.
 * @returns The account row's ID.
 */
export async function connectGitHubWithToken(
  userId: string,
  accessToken: string,
  options: { confirmed?: boolean; updatedAt?: Date; mfaVerified?: boolean } = {},
): Promise<string> {
  return connectProvider(db, userId, {
    accountId: `github-${accessToken}`,
    accessToken,
    mfaVerified: options.mfaVerified ?? false,
    confirmed: options.confirmed,
    updatedAt: options.updatedAt,
  });
}

/**
 * Stands in for GitHub's authenticated-user API: answers whether the account
 * an access token belongs to has two-factor authentication.
 *
 * @param twoFactorByToken - 2FA status by access token; unknown tokens have none.
 * @returns The `fetch` spy.
 */
export function mockGitHubApi(twoFactorByToken: Record<string, boolean>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const authorization = new Headers(init?.headers).get('authorization') ?? '';
    const token = authorization.replace(/^Bearer /, '');
    return Response.json({ two_factor_authentication: twoFactorByToken[token] ?? false });
  });
}

/**
 * Reads whether a GitHub account has 2FA, as stored.
 *
 * @param accountId - The account row.
 * @returns The stored `mfaVerified` flag.
 */
export async function storedGitHubMfa(accountId: string): Promise<boolean | null> {
  const found = firstRow(
    await db
      .select({ mfaVerified: account.mfaVerified })
      .from(account)
      .where(and(eq(account.id, accountId), eq(account.providerId, 'github'))),
    'the account',
  );
  return found.mfaVerified;
}

/**
 * Adds a passkey to a user, as Better Auth stores it when registration is
 * verified (before the after hook runs).
 *
 * @param userId - The user.
 */
export async function addPasskey(userId: string): Promise<void> {
  await addStoredPasskey(db, userId);
}

/**
 * Stores a trusted device ("Trust this device" at the code step), as Better Auth does.
 *
 * @param userId - Whose device it is.
 * @param name - What tells it apart from the user's other devices; their ID by default.
 * @returns Its identifier.
 */
export async function trustDevice(userId: string, name = userId): Promise<string> {
  const identifier = `trust-device-${name}`;
  await db.insert(verification).values({
    identifier,
    value: userId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
  });
  return identifier;
}

/**
 * Adds a browser's signed trusted-device cookie (`<HMAC>!<identifier>`) to its headers.
 *
 * @param headers - The browser's request headers.
 * @param identifier - The trusted device.
 * @param secret - The secret it's signed with; another one forges it.
 * @returns The same headers.
 */
export function withTrustedDevice(
  headers: Headers,
  identifier: string,
  secret = COOKIE_SECRET,
): Headers {
  const value = encodeURIComponent(signCookieValue(`hmac!${identifier}`, secret));
  const others = headers.get('cookie');
  headers.set('cookie', `${others ? `${others}; ` : ''}${TRUST_DEVICE_COOKIE}=${value}`);
  return headers;
}

/**
 * Lists which of these trusted devices are still stored.
 *
 * @param identifiers - The devices.
 * @returns Those left.
 */
export const devicesLeft = async (identifiers: string[]) =>
  (
    await db
      .select({ identifier: verification.identifier })
      .from(verification)
      .where(inArray(verification.identifier, identifiers))
  )
    .map(({ identifier }) => identifier)
    .sort();
