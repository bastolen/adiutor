/**
 * @file Runs Better Auth's real email-link sign-in (`auth.handler`, with the
 * app's guards and reactions) to check what only a whole request shows:
 * - a sign-in link is emailed to the account's stored address, whatever case
 *   the address was typed in (`sendMagicLink` in `src/lib/auth.ts`), in the
 *   account's language, else the browser's;
 * - a sign-in link can't go on to a second `/magic-link/verify`, which the
 *   browser would open as part of the same click and so sign the user in to
 *   whoever made the second link: asking for a link with such a return
 *   address is refused before a link is made or sent, and a verify request
 *   built by hand with one is refused before its link is used, so neither
 *   account gets a session (`refuseUnsafeReturnAddresses` in
 *   `src/server/auth/auth-guards/`); a normal link still signs in.
 *
 * The verify requests carry the `Sec-Fetch-*` headers of the "Continue
 * signing in" click, set by hand, so the guard lets them past the
 * confirmation page (`confirmSignInLinkFirst`) to the return address check.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { session, verification } from '@/db/schema';
import { auth } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { emailLinkVerificationIdentifier, generateToken } from '@/lib/sign-in/tokens';

import {
  createUser,
  emailLanguage,
  setUserLocale,
  setupTestContext,
} from '../../../tests/integration/helpers';

vi.mock('@/db', async (importOriginal) =>
  (await import('../../../tests/integration/app-modules')).default(await importOriginal()),
);
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

const { db } = setupTestContext();

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});

beforeEach(() => {
  vi.mocked(sendEmail).mockClear();
});

/** The user who clicks a genuine sign-in link for their own account. */
const VICTIM = 'victim@adiutor.test';

/** The user whose own sign-in link the victim's link would go on to. */
const ATTACKER = 'attacker@adiutor.test';

/** The return addresses of a sign-in link. */
const RETURN_FIELDS = ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL'] as const;

/** The headers of the "Continue signing in" click: a same-origin navigation the user made. */
const CLICK = {
  'sec-fetch-site': 'same-origin',
  'sec-fetch-user': '?1',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
};

/**
 * Stores a sign-in link the way Better Auth's magic-link plugin does, without
 * sending an email (like `storeSignInLink` in `e2e/support/db.ts`).
 *
 * @param email - The address it's for.
 * @returns The link's token.
 */
async function storeSignInLink(email: string): Promise<string> {
  const token = generateToken();
  await db.insert(verification).values({
    identifier: emailLinkVerificationIdentifier(token),
    value: JSON.stringify({ type: 'magic-link', email }),
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });
  return token;
}

/**
 * A return address that goes on to a second sign-in link.
 *
 * @param token - The second link's token.
 * @returns The path of Better Auth's verify endpoint for it, returning to the dashboard.
 */
function chainedTo(token: string): string {
  return `/api/auth/magic-link/verify?${new URLSearchParams({ token, callbackURL: '/dashboard' })}`;
}

/**
 * Asks for a sign-in link, as the sign-in form does.
 *
 * @param body - The JSON body: the address and the return addresses.
 * @param headers - More request headers, e.g. the language cookie.
 * @returns The response.
 */
function askForLink(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: env.BETTER_AUTH_URL, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * Opens Better Auth's verify endpoint, as the "Continue signing in" click does.
 *
 * @param query - The link's token and return addresses.
 * @returns The response.
 */
function openLink(query: Record<string, string>): Promise<Response> {
  return auth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/auth/magic-link/verify?${new URLSearchParams(query)}`, {
      headers: CLICK,
    }),
  );
}

/**
 * Counts the stored sign-in links (and other verification values).
 *
 * @returns How many there are.
 */
async function storedLinks(): Promise<number> {
  return (await db.select({ id: verification.id }).from(verification)).length;
}

/**
 * Counts a user's sessions.
 *
 * @param userId - The user.
 * @returns How many they have.
 */
async function sessionCount(userId: string): Promise<number> {
  return (await db.select({ id: session.id }).from(session).where(eq(session.userId, userId)))
    .length;
}

/**
 * Tells whether a response sets a session cookie.
 *
 * @param response - The response.
 * @returns Whether it does.
 */
function setsSessionCookie(response: Response): boolean {
  return response.headers.getSetCookie().some((cookie) => cookie.includes('session_token='));
}

describe('sending a sign-in link', () => {
  it('emails it to the stored address, whatever case it was typed in', async () => {
    await createUser(db, 'jane@adiutor.test');

    const response = await askForLink({ email: 'Jane@ADIUTOR.test', callbackURL: '/dashboard' });

    expect(response.status).toBe(200);
    // Sent after the response.
    const sent = await vi.waitFor(() => {
      const [email] = vi.mocked(sendEmail).mock.calls.map(([call]) => call);
      if (!email) {
        throw new Error('The sign-in email has not been sent yet');
      }
      return email;
    }, 10_000);
    expect(sent.subject).toBe('Your Adiutor sign-in link');
    expect(sent.to).toBe('jane@adiutor.test');
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
  });

  it('writes it in the language the account saved, else the browser’s', async () => {
    await setUserLocale(db, await createUser(db, 'jane@adiutor.test'), 'nl-NL');
    await createUser(db, 'sam@adiutor.test');
    const spanishBrowser = { cookie: 'adiutor.locale=es-ES' };

    await askForLink({ email: 'jane@adiutor.test', callbackURL: '/dashboard' }, spanishBrowser);
    await askForLink({ email: 'sam@adiutor.test', callbackURL: '/dashboard' }, spanishBrowser);

    // Sent after the responses.
    const sent = await vi.waitFor(() => {
      const emails = vi.mocked(sendEmail).mock.calls.map(([call]) => call);
      if (emails.length < 2) {
        throw new Error('The sign-in emails have not been sent yet');
      }
      return emails;
    }, 10_000);
    expect(
      sent
        .map((email) => [email.to, emailLanguage(email)])
        .sort(([a], [b]) => (a ?? '').localeCompare(b ?? '')),
    ).toEqual([
      ['jane@adiutor.test', 'nl-NL'],
      ['sam@adiutor.test', 'es-ES'],
    ]);
  });
});

describe('a sign-in link that goes on to a second one', () => {
  it.each(RETURN_FIELDS)(
    'is refused when asked for with it as %s, and nothing is sent',
    async (field) => {
      await createUser(db, VICTIM);
      await createUser(db, ATTACKER);
      const attackerLink = await storeSignInLink(ATTACKER);

      const response = await askForLink({ email: VICTIM, [field]: chainedTo(attackerLink) });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'UNSAFE_RETURN_ADDRESS' });
      // Better Auth stores a link before sending it: only the attacker's own is there.
      expect(await storedLinks()).toBe(1);
      expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
    },
  );

  it.each(RETURN_FIELDS)(
    'is refused when opened with it as %s, before either link is used',
    async (field) => {
      const victim = await createUser(db, VICTIM);
      const attacker = await createUser(db, ATTACKER);
      const victimLink = await storeSignInLink(VICTIM);
      const attackerLink = await storeSignInLink(ATTACKER);

      const response = await openLink({
        token: victimLink,
        callbackURL: '/dashboard',
        [field]: chainedTo(attackerLink),
      });

      // The sign-in error page explains it; the browser never gets to the second link.
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/sign-in-error?error=UNSAFE_RETURN_ADDRESS');
      expect(setsSessionCookie(response)).toBe(false);
      expect(await sessionCount(victim)).toBe(0);
      expect(await sessionCount(attacker)).toBe(0);
      expect(await storedLinks()).toBe(2);
    },
  );

  it('leaves a normal link working', async () => {
    const victim = await createUser(db, VICTIM);
    const victimLink = await storeSignInLink(VICTIM);

    const response = await openLink({
      token: victimLink,
      callbackURL: '/dashboard',
      errorCallbackURL: '/auth?callbackURL=%2Fdashboard',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      new URL('/dashboard', env.BETTER_AUTH_URL).toString(),
    );
    expect(setsSessionCookie(response)).toBe(true);
    expect(await sessionCount(victim)).toBe(1);
    // Used up.
    expect(await storedLinks()).toBe(0);
  });
});
