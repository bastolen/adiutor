/**
 * @file Runs Better Auth's real password sign-in (`auth.handler`, with its
 * plugins and the app's reactions) to check what only a whole request shows:
 * - the audit log gets one `sign_in` per sign-in, also when the code step
 *   comes in between, because the app records a password sign-in after
 *   Better Auth's two-step plugin decided on its session
 *   (`passwordSignInEvents` in `src/lib/auth.ts`); turning on email codes
 *   isn't a sign-in, and a wrong password or a deactivated account records
 *   only the failed attempt;
 * - signing in on a browser where someone else is still signed in ends
 *   their session there, and forgets their "Trust this device", as signing
 *   out would (`replacePreviousSession`), also when the code step follows;
 * - signing out forgets the browser's trusted device itself, so even a copy
 *   of its cookie asks for the code again;
 * - sessions last a fixed 7 days: reading one the way every page does
 *   (`getOptionalActor`, while a Server Component renders) doesn't extend it,
 *   since a page can't extend its cookie, and neither does turning two-step
 *   verification on or off, which replaces it (`beforeSessionCreate`), and
 *   when the user was last active is written in the background
 *   (`startInBackground`), so the page never waits for it;
 * - a wrong code at the code step (which has no session yet) is recorded
 *   without an actor (`pendingCodeSignIn`, `reactToRefusedSignInCode`),
 *   and the owner is told once when wrong codes pause signing in with a
 *   code (Better Auth's account lockout), without the device that typed them;
 * - an emailed code is in the account's language, else the browser's, and so
 *   is a verification link (English (US) outside a request);
 * - signing in again ends the wait for a new emailed code, since Better Auth
 *   keeps a code with the sign-in it was asked for and the last one can't be
 *   used for the new code step (`afterPasswordSignIn`), while the wait within
 *   one sign-in, other users' waits and the 5 codes per 15 minutes stay.
 */
import { hashPassword } from 'better-auth/crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { account, auditEvent, session, user } from '@/db/schema';
import { auth } from '@/lib/auth';
import { TWO_FACTOR_LOCK_ATTEMPTS } from '@/lib/authz/mfa';
import { defined, firstRow } from '@/lib/defined';
import { type Email, sendEmail } from '@/lib/email';
import { env } from '@/lib/env';

import {
  authenticatorCode as codeFromSecret,
  storeAuthenticator,
} from '../../../tests/auth/authenticator';
import {
  createUser,
  emailLanguage,
  enableTwoFactor,
  inSequence,
  lastActiveAt,
  sendQueuedEmails,
  setUserLocale,
  setupTestContext,
} from '../../../tests/integration/helpers';
import { getOptionalActor } from '../authz';

/** The request a page renders for; tests set its headers (e.g. the browser's cookies). */
const pageRequest = vi.hoisted(() => ({ headers: new Headers() }));

/**
 * Work that runs in the background, to wait for: Better Auth's, run after its
 * responses (`runInBackground` in `src/lib/auth.ts`, through Next's `after`),
 * such as emails, and the app's own (`startInBackground` in
 * `src/server/background.ts`), such as recording last activity.
 */
const backgroundTasks = vi.hoisted((): unknown[] => []);

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));
// What pages read the signed-in user with (`src/server/authz.ts`), outside Next.
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => pageRequest.headers) }));
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }));
// Outside Next, `after` would throw and the work would just run; here it's also kept to wait for.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  /**
   * Keeps Better Auth's work, a promise already started, to wait for.
   *
   * @param task - The work.
   */
  after: (task: unknown) => {
    backgroundTasks.push(task);
  },
}));
vi.mock('../background', () => ({
  /**
   * Keeps the app's work, to run only once `backgroundWork` is awaited.
   *
   * @param description - What the work does (unused here).
   * @param task - The work.
   */
  default: (description: string, task: () => Promise<unknown>) => {
    backgroundTasks.push(task);
  },
}));

const { ctx, db } = setupTestContext();

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});

/**
 * Waits for the background work so far: Better Auth's, already started, and
 * the app's own (functions such as recording last activity), which run now.
 */
async function backgroundWork(): Promise<void> {
  await Promise.all(
    backgroundTasks.splice(0).map((task) => (typeof task === 'function' ? task() : task)),
  );
}

beforeEach(() => {
  vi.mocked(sendEmail).mockClear();
});

// So none of it still runs while the next test starts.
afterEach(backgroundWork);

/** The test users' password. */
const PASSWORD = 'adiutor-tests-password';

/** A day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Creates a user who signs in with a password, as Better Auth stores it.
 *
 * @param email - Their address.
 * @returns Their ID.
 */
async function createUserWithPassword(email: string): Promise<string> {
  const id = await createUser(db, email);
  await db.insert(account).values({
    userId: id,
    accountId: id,
    providerId: 'credential',
    password: await hashPassword(PASSWORD),
  });
  return id;
}

/**
 * A browser talking to Better Auth: it keeps the cookies responses set and
 * drops the ones they expire, and sends them with every request.
 *
 * @param headers - More headers it sends with every request, e.g. its `user-agent`.
 * @returns The browser.
 */
function newBrowser(headers: Record<string, string> = {}) {
  const cookies = new Map<string, string>();

  /**
   * The cookies it sends.
   *
   * @returns A `Cookie` header.
   */
  const cookie = () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');

  /**
   * Keeps the cookies a response sets, and drops the ones it expires.
   *
   * @param response - The response.
   */
  const keep = (response: Response) => {
    response.headers.getSetCookie().forEach((set) => {
      const [first, ...attributes] = set.split(';');
      const pair = defined(first, 'the cookie name and value');
      const name = pair.slice(0, pair.indexOf('=')).trim();
      const value = pair.slice(pair.indexOf('=') + 1);
      const expired =
        value === '' || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expired) {
        cookies.delete(name);
      } else {
        cookies.set(name, value);
      }
    });
  };

  return {
    cookie,

    /**
     * Sends a request to a Better Auth endpoint, as the app's pages do.
     *
     * @param path - The endpoint, e.g. `sign-in/email`.
     * @param body - The JSON body.
     * @returns The response.
     */
    async post(path: string, body: Record<string, unknown> = {}): Promise<Response> {
      const response = await auth.handler(
        new Request(`${env.BETTER_AUTH_URL}/api/auth/${path}`, {
          method: 'POST',
          headers: {
            ...headers,
            'content-type': 'application/json',
            origin: env.BETTER_AUTH_URL,
            cookie: cookie(),
          },
          body: JSON.stringify(body),
        }),
      );
      keep(response);
      return response;
    },

    /**
     * Forgets cookies, as when a session cookie expires.
     *
     * @param name - Which cookies, by name.
     */
    forget(name: RegExp): void {
      [...cookies.keys()].filter((key) => name.test(key)).forEach((key) => cookies.delete(key));
    },

    /**
     * Copies cookies, as someone who got hold of them would.
     *
     * @param name - Which cookies, by name.
     * @returns Their names and values.
     */
    copy(name: RegExp): [string, string][] {
      return [...cookies].filter(([key]) => name.test(key));
    },

    /**
     * Sends copied cookies again from now on, as a browser holding a copy would.
     *
     * @param copied - Cookies from `copy`.
     */
    restore(copied: [string, string][]): void {
      copied.forEach(([key, value]) => cookies.set(key, value));
    },
  };
}

/** A browser from {@link newBrowser}. */
type Browser = ReturnType<typeof newBrowser>;

/**
 * Signs in with a password.
 *
 * @param browser - The browser.
 * @param email - The address.
 * @returns What Better Auth answered: a session, or that the code step started.
 */
async function signInWithPassword(
  browser: Browser,
  email: string,
): Promise<{ twoFactorRedirect?: boolean }> {
  const response = await browser.post('sign-in/email', { email, password: PASSWORD });
  expect(response.status).toBe(200);
  return (await response.json()) as { twoFactorRedirect?: boolean };
}

/**
 * Waits for the code email to an address, which is sent after the response,
 * in whatever language.
 *
 * @param to - The address.
 * @returns The email.
 */
async function codeEmailTo(to: string): Promise<Email> {
  return vi.waitFor(() => {
    const found = vi
      .mocked(sendEmail)
      .mock.calls.map(([sent]) => sent)
      .find((sent) => sent.to === to && /\b\d{6}\b/.test(sent.text));
    if (!found) {
      throw new Error('The code email has not been sent yet');
    }
    return found;
  }, 10_000);
}

/**
 * Asks for an email code and reads it from the email, which is sent after
 * the response.
 *
 * @param browser - The browser, at the code step or signed in.
 * @returns The code.
 */
async function emailedCode(browser: Browser): Promise<string> {
  vi.mocked(sendEmail).mockClear();
  expect((await browser.post('two-factor/send-otp')).status).toBe(200);
  // Rendering the first email can take a moment.
  const email = await vi.waitFor(() => {
    const [found] = vi
      .mocked(sendEmail)
      .mock.calls.map(([sent]) => sent)
      .filter((sent) => sent.subject === 'Your Adiutor sign-in code');
    if (!found) {
      throw new Error('The code email has not been sent yet');
    }
    return found;
  }, 10_000);
  const code = email.text.match(/\b\d{6}\b/)?.[0];
  if (!code) {
    throw new Error('No code in the email');
  }
  return code;
}

/**
 * Reads the audit log, oldest first.
 *
 * @returns Each event's action, actor, target and details.
 */
async function events() {
  const rows = await db
    .select({
      action: auditEvent.action,
      actorUserId: auditEvent.actorUserId,
      targetUserId: auditEvent.targetUserId,
      details: auditEvent.details,
    })
    .from(auditEvent)
    .orderBy(asc(auditEvent.id));
  return rows.map(({ action, actorUserId, targetUserId, details }) => [
    action,
    actorUserId,
    targetUserId,
    details,
  ]);
}

/**
 * Reads a user's sessions, newest first.
 *
 * @param userId - The user.
 * @returns Their sessions.
 */
async function sessionsOf(userId: string) {
  return db
    .select({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      mfaMethod: session.mfaMethod,
    })
    .from(session)
    .where(eq(session.userId, userId))
    .orderBy(desc(session.createdAt));
}

/** The raw secret of the test users' authenticator app. */
const AUTHENTICATOR_SECRET = 'adiutor-tests-authenticator-secret';

/** A browser's `user-agent`, to check the lockout email leaves out who typed the codes. */
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';

/** The lockout email's subject (`two_factor_locked` in `src/emails/security-notice.tsx`). */
const LOCKED_SUBJECT = 'Signing in to your Adiutor account with a code is paused';

/**
 * Sets up an authenticator app for a user, as Better Auth stores it once its
 * first code was right.
 *
 * @param userId - The user.
 */
async function setUpAuthenticator(userId: string): Promise<void> {
  const { secretConfig } = await auth.$context;
  await storeAuthenticator(db, userId, AUTHENTICATOR_SECRET, secretConfig);
}

/**
 * The code the authenticator app shows for the test users' secret.
 *
 * @param stepOffset - Which 30 seconds, from now; the current ones by default.
 * @returns The code.
 */
function authenticatorCode(stepOffset = 0): string {
  return codeFromSecret(AUTHENTICATOR_SECRET, stepOffset);
}

/**
 * A code Better Auth refuses: none of the app's codes from a minute before to
 * a minute after now (it accepts the previous, current and next 30 seconds).
 *
 * @returns The code.
 */
function wrongAuthenticatorCode(): string {
  const accepted = new Set([-2, -1, 0, 1, 2].map(authenticatorCode));
  const wrong = [...'0123456789'].map((digit) => digit.repeat(6)).find((c) => !accepted.has(c));
  if (!wrong) {
    throw new Error('Every candidate code is accepted');
  }
  return wrong;
}

/**
 * Lists the lockout emails sent so far.
 *
 * @returns Each one's recipient and plain text.
 */
async function lockoutEmails() {
  // Notices are queued: send them first, through the mocked `sendEmail`.
  await sendQueuedEmails({ ...ctx, sendEmail });
  return vi
    .mocked(sendEmail)
    .mock.calls.map(([sent]) => sent)
    .filter((sent) => sent.subject === LOCKED_SUBJECT)
    .map(({ to, text }) => ({ to, text }));
}

describe('signing in with a password', () => {
  it('records one sign-in without two-step verification', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');

    expect(await signInWithPassword(newBrowser(), 'jane@adiutor.test')).not.toHaveProperty(
      'twoFactorRedirect',
    );

    expect(await events()).toEqual([['sign_in', jane, jane, { method: 'password' }]]);
    expect(await sessionsOf(jane)).toHaveLength(1);
    expect(await lastActiveAt(db, jane)).not.toBeNull();
  });

  it('records the password, then one sign-in once the code step is finished', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    await enableTwoFactor(db, jane, 'email');
    const browser = newBrowser();
    const emailsBefore = vi.mocked(sendEmail).mock.calls.length;

    expect(await signInWithPassword(browser, 'jane@adiutor.test')).toMatchObject({
      twoFactorRedirect: true,
    });
    // No security email for the password step: the code is sent when the code step asks for it.
    expect(vi.mocked(sendEmail).mock.calls).toHaveLength(emailsBefore);
    // Better Auth deleted the password's session; whoever typed it isn't signed in or active.
    expect(await events()).toEqual([['sign_in_code_pending', null, jane, { method: 'password' }]]);
    expect(await sessionsOf(jane)).toEqual([]);
    expect(await lastActiveAt(db, jane)).toBeNull();

    const code = await emailedCode(browser);
    expect((await browser.post('two-factor/verify-otp', { code })).status).toBe(200);

    expect(await events()).toEqual([
      ['sign_in_code_pending', null, jane, { method: 'password' }],
      ['sign_in', jane, jane, { method: 'password_and_email_code' }],
    ]);
    expect(await sessionsOf(jane)).toHaveLength(1);
    expect(await lastActiveAt(db, jane)).not.toBeNull();
  });

  it('emails the code in the language the account saved, else the browser’s', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    const sam = await createUserWithPassword('sam@adiutor.test');
    await enableTwoFactor(db, jane, 'email');
    await enableTwoFactor(db, sam, 'email');
    await setUserLocale(db, jane, 'nl-NL');

    /**
     * Signs in on a Spanish browser and asks for a code.
     *
     * @param email - The address.
     * @returns The language of the code email.
     */
    const codeLanguage = async (email: string) => {
      const browser = newBrowser();
      browser.restore([['adiutor.locale', 'es-ES']]);
      await signInWithPassword(browser, email);
      expect((await browser.post('two-factor/send-otp')).status).toBe(200);
      return emailLanguage(await codeEmailTo(email));
    };

    expect(await codeLanguage('jane@adiutor.test')).toBe('nl-NL');
    expect(await codeLanguage('sam@adiutor.test')).toBe('es-ES');
  });

  it('emails a verification link in the language the account saved, else English (US) outside a request', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await createUser(db, 'sam@adiutor.test');
    await db.update(user).set({ emailVerified: false });
    await setUserLocale(db, jane, 'nl-NL');

    // As the account page's action asks for it (`auth.api`, which passes Better Auth no request).
    await Promise.all(
      ['jane@adiutor.test', 'sam@adiutor.test'].map((email) =>
        auth.api.sendVerificationEmail({ body: { email, callbackURL: '/account' } }),
      ),
    );

    const sent = vi.mocked(sendEmail).mock.calls.map(([call]) => call);
    expect(
      sent
        .map((email) => [email.to, emailLanguage(email)])
        .sort(([a], [b]) => (a ?? '').localeCompare(b ?? '')),
    ).toEqual([
      ['jane@adiutor.test', 'nl-NL'],
      ['sam@adiutor.test', 'en-US'],
    ]);
  });

  it("ends the browser's session when its password is typed again and the code step starts", async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    await enableTwoFactor(db, jane, 'email');
    const browser = newBrowser();
    await signInWithPassword(browser, 'jane@adiutor.test');
    await browser.post('two-factor/verify-otp', { code: await emailedCode(browser) });
    const first = firstRow(await sessionsOf(jane), 'the first session');
    expect(browser.cookie()).toMatch(/session_token=/);

    // Better Auth expires the session cookie when the code step starts, so the old session is
    // unusable; the app ends it now, the last moment it can be found (see replacePreviousSession).
    expect(await signInWithPassword(browser, 'jane@adiutor.test')).toMatchObject({
      twoFactorRedirect: true,
    });
    expect(browser.cookie()).not.toMatch(/session_token=/);
    expect(await sessionsOf(jane)).toEqual([]);

    // Finishing the code step leaves exactly one session: no dead one stays listed as a device.
    await browser.post('two-factor/verify-otp', { code: await emailedCode(browser) });
    const sessions = await sessionsOf(jane);
    expect(sessions).toHaveLength(1);
    expect(defined(sessions[0], 'the new session').id).not.toBe(first.id);
  });

  it('records one sign-in on a trusted device, and marks its session', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    await enableTwoFactor(db, jane, 'email');
    const browser = newBrowser();
    await signInWithPassword(browser, 'jane@adiutor.test');
    const code = await emailedCode(browser);
    await browser.post('two-factor/verify-otp', { code, trustDevice: true });

    // The session ended without signing out, so the device is still trusted.
    browser.forget(/session_token/);
    expect(await signInWithPassword(browser, 'jane@adiutor.test')).not.toHaveProperty(
      'twoFactorRedirect',
    );

    expect(await events()).toEqual([
      ['sign_in_code_pending', null, jane, { method: 'password' }],
      ['sign_in', jane, jane, { method: 'password_and_email_code' }],
      ['sign_in', jane, jane, { method: 'password' }],
    ]);
    const newest = firstRow(await sessionsOf(jane), 'the newest session');
    expect(newest.mfaMethod).toBe('trusted_device');
  });

  it('forgets the trusted device when the user signs out there, so even a copy of its cookie asks for the code', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    await enableTwoFactor(db, jane, 'email');
    const browser = newBrowser();
    await signInWithPassword(browser, 'jane@adiutor.test');
    await browser.post('two-factor/verify-otp', {
      code: await emailedCode(browser),
      trustDevice: true,
    });
    const copied = browser.copy(/trust_device/);
    expect(copied).toHaveLength(1);

    expect((await browser.post('sign-out')).status).toBe(200);
    expect(browser.cookie()).not.toMatch(/trust_device=/);

    // Someone kept a copy of the cookie (or the browser never dropped it).
    browser.restore(copied);
    expect(await signInWithPassword(browser, 'jane@adiutor.test')).toMatchObject({
      twoFactorRedirect: true,
    });
  });

  describe('on a browser where someone else is still signed in', () => {
    it('ends their session there, as signing out would, without recording it for them', async () => {
      const jane = await createUserWithPassword('jane@adiutor.test');
      const bob = await createUserWithPassword('bob@adiutor.test');
      const browser = newBrowser();
      await signInWithPassword(browser, 'jane@adiutor.test');

      await signInWithPassword(browser, 'bob@adiutor.test');

      expect(await sessionsOf(jane)).toEqual([]);
      expect(await sessionsOf(bob)).toHaveLength(1);
      expect(await events()).toEqual([
        ['sign_in', jane, jane, { method: 'password' }],
        ['sign_in', bob, bob, { method: 'password' }],
      ]);
    });

    it('ends their session at the password step when the code step follows', async () => {
      const jane = await createUserWithPassword('jane@adiutor.test');
      const bob = await createUserWithPassword('bob@adiutor.test');
      await enableTwoFactor(db, bob, 'email');
      const browser = newBrowser();
      await signInWithPassword(browser, 'jane@adiutor.test');

      expect(await signInWithPassword(browser, 'bob@adiutor.test')).toMatchObject({
        twoFactorRedirect: true,
      });

      expect(await sessionsOf(jane)).toEqual([]);
      expect(browser.cookie()).not.toMatch(/session_token=/);
    });

    it('forgets their trusted device, so their next password sign-in asks for the code again', async () => {
      const jane = await createUserWithPassword('jane@adiutor.test');
      await enableTwoFactor(db, jane, 'email');
      await createUserWithPassword('bob@adiutor.test');
      const browser = newBrowser();
      await signInWithPassword(browser, 'jane@adiutor.test');
      await browser.post('two-factor/verify-otp', {
        code: await emailedCode(browser),
        trustDevice: true,
      });
      expect(browser.cookie()).toMatch(/trust_device=/);

      // Bob has no code step, so Better Auth's two-step plugin leaves the cookie alone itself.
      await signInWithPassword(browser, 'bob@adiutor.test');

      expect(await sessionsOf(jane)).toEqual([]);
      expect(browser.cookie()).not.toMatch(/trust_device=/);
      expect(await signInWithPassword(browser, 'jane@adiutor.test')).toMatchObject({
        twoFactorRedirect: true,
      });
    });
  });

  it("doesn't record turning on email codes as a sign-in", async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    const browser = newBrowser();
    await signInWithPassword(browser, 'jane@adiutor.test');

    // Better Auth replaces the session once the first code is right.
    const code = await emailedCode(browser);
    expect((await browser.post('two-factor/verify-otp', { code })).status).toBe(200);

    expect(await events()).toEqual([
      ['sign_in', jane, jane, { method: 'password' }],
      ['two_factor_enabled', jane, jane, { method: 'email_code' }],
    ]);
    expect(await sessionsOf(jane)).toHaveLength(1);
  });

  it('records only the failed attempt for a wrong password, or a deactivated account', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    await enableTwoFactor(db, jane, 'email');
    const browser = newBrowser();

    const wrong = await browser.post('sign-in/email', {
      email: 'jane@adiutor.test',
      password: 'adiutor-tests-wrong-password',
    });
    expect(wrong.status).toBe(401);
    // The right password, but the account can't sign in: its session is refused before the code step.
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, jane));
    const deactivated = await browser.post('sign-in/email', {
      email: 'jane@adiutor.test',
      password: PASSWORD,
    });
    expect(deactivated.status).toBe(403);

    expect((await events()).map(([action]) => action)).toEqual([
      'sign_in_failed',
      'sign_in_failed',
    ]);
    expect(await sessionsOf(jane)).toEqual([]);
    expect(await lastActiveAt(db, jane)).toBeNull();
  });
});

describe('an emailed code after signing in again', () => {
  /**
   * Asks for an emailed code and reads why it was refused.
   *
   * @param browser - The browser, at the code step.
   * @returns The response's status and error code.
   */
  const refusedCode = async (browser: Browser) => {
    const response = await browser.post('two-factor/send-otp');
    const { code } = (await response.json()) as { code?: string };
    return [response.status, code];
  };

  it('is sent straight away, since the last one belongs to the sign-in it replaced', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    await enableTwoFactor(db, jane, 'email');
    const browser = newBrowser();
    await signInWithPassword(browser, 'jane@adiutor.test');
    const first = await emailedCode(browser);
    // Within the wait, for the same sign-in: its code still works, so no new one.
    expect(await refusedCode(browser)).toEqual([429, 'EMAIL_CODE_SENT_RECENTLY']);

    // Back to the sign-in page and in again: a new code step, which the first code isn't for.
    await signInWithPassword(browser, 'jane@adiutor.test');
    const stale = await browser.post('two-factor/verify-otp', { code: first });
    expect(stale.status).toBe(400);
    expect(await stale.json()).toMatchObject({ code: 'OTP_HAS_EXPIRED' });

    // So its own code is sent without waiting for the first one's 2.5 minutes, and signs in.
    const second = await emailedCode(browser);
    expect((await browser.post('two-factor/verify-otp', { code: second })).status).toBe(200);
    expect(await sessionsOf(jane)).toHaveLength(1);
  });

  it('still waits within one sign-in, and for someone else’s sign-in', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    const sam = await createUserWithPassword('sam@adiutor.test');
    await enableTwoFactor(db, jane, 'email');
    await enableTwoFactor(db, sam, 'email');
    const janes = newBrowser();
    await signInWithPassword(janes, 'jane@adiutor.test');
    await emailedCode(janes);

    // Sam's sign-in is a challenge of his own: Jane's wait stays.
    await signInWithPassword(newBrowser(), 'sam@adiutor.test');

    expect(await refusedCode(janes)).toEqual([429, 'EMAIL_CODE_SENT_RECENTLY']);
  });

  it('is still limited to 5 per 15 minutes, however often the password is typed', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    await enableTwoFactor(db, jane, 'email');
    const browser = newBrowser();
    // One code per sign-in, five times.
    const statuses = await inSequence([1, 2, 3, 4, 5], async () => {
      await signInWithPassword(browser, 'jane@adiutor.test');
      return (await browser.post('two-factor/send-otp')).status;
    });
    expect(statuses).toEqual([200, 200, 200, 200, 200]);

    // The sixth sign-in may ask at once too, but there are no codes left to send.
    await signInWithPassword(browser, 'jane@adiutor.test');
    expect(await refusedCode(browser)).toEqual([429, 'TOO_MANY_ATTEMPTS']);
  });
});

describe('wrong codes at the code step', () => {
  it('records a wrong authenticator or backup code without an actor', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    await setUpAuthenticator(jane);
    const browser = newBrowser({ 'user-agent': FIREFOX });
    await signInWithPassword(browser, 'jane@adiutor.test');

    const wrongCode = await browser.post('two-factor/verify-totp', {
      code: wrongAuthenticatorCode(),
    });
    const wrongBackupCode = await browser.post('two-factor/verify-backup-code', {
      code: 'adiutor-tests-wrong-backup-code',
    });

    expect([wrongCode.status, wrongBackupCode.status]).toEqual([401, 401]);
    // Whoever typed them may not be Jane: no actor, so her own activity leaves out their browser.
    expect(await events()).toEqual([
      ['sign_in_code_pending', null, jane, { method: 'password' }],
      ['mfa_failed', null, jane, { method: 'authenticator', atSignIn: true }],
      ['mfa_failed', null, jane, { method: 'backup_code', atSignIn: true }],
    ]);
    await backgroundWork();
    expect(await lockoutEmails()).toEqual([]);
  });

  it('records a wrong email code too', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    await enableTwoFactor(db, jane, 'email');
    const browser = newBrowser();
    await signInWithPassword(browser, 'jane@adiutor.test');
    const code = await emailedCode(browser);

    const wrong = await browser.post('two-factor/verify-otp', {
      code: code === '000000' ? '111111' : '000000',
    });

    expect(wrong.status).toBe(401);
    expect(await events()).toEqual([
      ['sign_in_code_pending', null, jane, { method: 'password' }],
      ['mfa_failed', null, jane, { method: 'email_code', atSignIn: true }],
    ]);
  });

  it('records nothing for a right code but the sign-in', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    await setUpAuthenticator(jane);
    const browser = newBrowser();
    await signInWithPassword(browser, 'jane@adiutor.test');

    const right = await browser.post('two-factor/verify-totp', { code: authenticatorCode() });

    expect(right.status).toBe(200);
    expect(await events()).toEqual([
      ['sign_in_code_pending', null, jane, { method: 'password' }],
      ['sign_in', jane, jane, { method: 'password_and_authenticator' }],
    ]);
    await backgroundWork();
    expect(await lockoutEmails()).toEqual([]);
  });

  it('tells the owner once when wrong codes pause signing in with a code, not again while paused', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    await setUpAuthenticator(jane);
    const browser = newBrowser({ 'user-agent': FIREFOX });
    const wrongCode = wrongAuthenticatorCode();
    /**
     * Enters a wrong authenticator code.
     *
     * @returns Better Auth's answer: its status and error code.
     */
    const guess = async () => {
      const response = await browser.post('two-factor/verify-totp', { code: wrongCode });
      const { code } = (await response.json()) as { code?: string };
      return [response.status, code];
    };

    // Better Auth allows 5 codes per sign-in, so the 10 in a row that pause it take two sign-ins.
    const answers: unknown[] = [];
    for (let attempt = 0; attempt < TWO_FACTOR_LOCK_ATTEMPTS; attempt += 1) {
      if (attempt % 5 === 0) {
        // eslint-disable-next-line no-await-in-loop -- Sign-ins and guesses must happen in order.
        await signInWithPassword(browser, 'jane@adiutor.test');
      }
      // eslint-disable-next-line no-await-in-loop -- Same.
      answers.push(await guess());
    }
    await backgroundWork();

    expect(answers).toEqual(
      Array.from({ length: TWO_FACTOR_LOCK_ATTEMPTS }, () => [401, 'INVALID_CODE']),
    );
    const sent = await lockoutEmails();
    expect(sent).toHaveLength(1);
    const notice = defined(sent[0], 'the lockout email');
    expect(notice.to).toBe('jane@adiutor.test');
    // Whoever typed the codes may be someone else: their browser isn't named.
    expect(notice.text).not.toMatch(/Firefox|From:/);

    // While it's paused, every code is refused, on a new sign-in too, and the owner isn't told again.
    expect(await guess()).toEqual([429, 'ACCOUNT_TEMPORARILY_LOCKED']);
    await signInWithPassword(browser, 'jane@adiutor.test');
    expect(await guess()).toEqual([429, 'ACCOUNT_TEMPORARILY_LOCKED']);
    const right = await browser.post('two-factor/verify-totp', { code: authenticatorCode() });
    expect(right.status).toBe(429);
    await backgroundWork();

    expect(await lockoutEmails()).toHaveLength(1);
    // Only the codes Better Auth compared are recorded as wrong.
    const wrongCodes = (await events()).filter(([action]) => action === 'mfa_failed');
    expect(wrongCodes).toHaveLength(TWO_FACTOR_LOCK_ATTEMPTS);
  });
});

describe('a session', () => {
  it('lasts 7 days from the sign-in, as long as its cookie', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    const response = await newBrowser().post('sign-in/email', {
      email: 'jane@adiutor.test',
      password: PASSWORD,
    });

    const created = firstRow(await sessionsOf(jane), 'the new session');
    expect(
      Math.abs(created.expiresAt.getTime() - created.createdAt.getTime() - 7 * DAY_MS),
    ).toBeLessThan(5_000);
    const sessionCookie = response.headers
      .getSetCookie()
      .find((set) => set.includes('session_token='));
    expect(sessionCookie).toMatch(/Max-Age=604800/i);
  });

  it("isn't extended when a page reads it, so it ends with its cookie", async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    const browser = newBrowser();
    await signInWithPassword(browser, 'jane@adiutor.test');
    const created = firstRow(await sessionsOf(jane), 'the new session');
    // Signed in two days ago: Better Auth would extend it (at most once a day) whenever it's read.
    const expiresAt = new Date(Date.now() + 5 * DAY_MS);
    await db
      .update(session)
      .set({ expiresAt, updatedAt: new Date(Date.now() - 2 * DAY_MS) })
      .where(eq(session.id, created.id));

    // A page load: the page finds the signed-in user while it renders, where cookies can't be set.
    pageRequest.headers = new Headers({ cookie: browser.cookie() });
    const actor = await getOptionalActor();

    expect(actor?.id).toBe(jane);
    const after = firstRow(await sessionsOf(jane), 'the session afterwards');
    expect(after.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it('records last activity in the background, so the page never waits for it', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    const browser = newBrowser();
    await signInWithPassword(browser, 'jane@adiutor.test');
    await backgroundWork();
    // Last active two minutes ago: the next request may record it again.
    const before = new Date(Date.now() - 2 * 60_000);
    await db.update(user).set({ lastActiveAt: before }).where(eq(user.id, jane));
    /**
     * Reads when Jane was last active.
     *
     * @returns The time, or `null`.
     */
    const lastActive = async () =>
      firstRow(
        await db.select({ at: user.lastActiveAt }).from(user).where(eq(user.id, jane)),
        'Jane',
      ).at;

    pageRequest.headers = new Headers({ cookie: browser.cookie() });
    expect((await getOptionalActor())?.id).toBe(jane);

    // The page has its user before anything is written.
    expect(await lastActive()).toEqual(before);
    await backgroundWork();
    expect(defined(await lastActive(), 'the time Jane was last active').getTime()).toBeGreaterThan(
      before.getTime(),
    );
  });

  it('keeps its sign-in time and end when turning two-step verification on or off replaces it', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    const browser = newBrowser();
    await signInWithPassword(browser, 'jane@adiutor.test');
    const created = firstRow(await sessionsOf(jane), 'the new session');
    // Signed in half an hour ago: within the hour a change without a second step needs.
    const createdAt = new Date(Date.now() - 30 * 60_000);
    const expiresAt = new Date(createdAt.getTime() + 7 * DAY_MS);
    await db.update(session).set({ createdAt, expiresAt }).where(eq(session.id, created.id));

    // The first code turns on email codes, and Better Auth replaces the session.
    const code = await emailedCode(browser);
    expect((await browser.post('two-factor/verify-otp', { code })).status).toBe(200);
    const turnedOn = await sessionsOf(jane);
    expect(turnedOn).toHaveLength(1);
    expect(defined(turnedOn[0], 'the session after turning it on').id).not.toBe(created.id);
    expect(turnedOn[0]).toMatchObject({ createdAt, expiresAt });

    // Turning it off replaces it again.
    expect((await browser.post('two-factor/disable', { password: PASSWORD })).status).toBe(200);
    const turnedOff = await sessionsOf(jane);
    expect(turnedOff).toHaveLength(1);
    expect(defined(turnedOff[0], 'the session after turning it off').id).not.toBe(
      defined(turnedOn[0], 'the session after turning it on').id,
    );
    expect(turnedOff[0]).toMatchObject({ createdAt, expiresAt });
  });
});
