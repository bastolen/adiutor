/**
 * @file Integration tests for the language at sign-in: the browser gets the
 * account's language, an account on Default saves only a language picked in
 * the browser (never a guessed one), and a password whose code step is still
 * to come changes nothing.
 */
import { getOAuthState } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { user } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import {
  createSession,
  createStaffSettings,
  createUser,
  setUserLocale,
} from '../../../../tests/integration/helpers';
import { afterAuthRequest } from './after-request';
import type { AuthHookContext } from './hook-context';
import { afterPasswordSignIn } from './password-sign-in';
import { db, githubCallback } from './test-helpers';

vi.mock('@/db', async (importOriginal) =>
  (await import('../../../../tests/integration/app-modules')).default(await importOriginal()),
);

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

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
  vi.mocked(getOAuthState).mockReset().mockResolvedValue(null);
});

/**
 * Reads a user's saved language.
 *
 * @param userId - The user.
 * @returns Their `user.locale`.
 */
async function savedLocale(userId: string) {
  return firstRow(
    await db.select({ locale: user.locale }).from(user).where(eq(user.id, userId)),
    'the user',
  ).locale;
}

/**
 * The context of a password sign-in once Better Auth's two-step plugin has
 * decided on its session, with the request's language headers.
 *
 * @param headers - The request's headers (cookie, `Accept-Language`).
 * @param newSession - The session that stayed, or `null` when the code step comes next.
 * @param newSession.sessionId - Its ID.
 * @param newSession.userId - Its user.
 * @returns The context and its `setCookie` mock.
 */
function passwordSignIn(
  headers: Record<string, string>,
  newSession: { sessionId: string; userId: string } | null,
) {
  const setCookie = vi.fn<NonNullable<AuthHookContext['setCookie']>>();
  const ctx: AuthHookContext = {
    path: '/sign-in/email',
    headers: new Headers(headers),
    setCookie,
    body: { email: 'jane@adiutor.test', password: 'adiutor-tests-password' },
    context: {
      returned: newSession
        ? { redirect: false, token: 'adiutor-tests-token' }
        : { twoFactorRedirect: true, twoFactorMethods: ['otp'] },
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
 * The language cookies a request set.
 *
 * @param setCookie - The request's `setCookie` mock.
 * @returns The values it set the language cookie to.
 */
const languageCookies = (setCookie: ReturnType<typeof passwordSignIn>['setCookie']) =>
  setCookie.mock.calls.filter(([name]) => name === 'adiutor.locale').map(([, value]) => value);

describe('the language at sign-in', () => {
  it("keeps an account on Default without a language picked in the browser: neither the browser's nor Adiutor's default is saved", async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = passwordSignIn(
      { 'accept-language': 'nl-BE,nl;q=0.9' },
      { sessionId, userId: jane },
    );

    await afterPasswordSignIn(ctx);

    expect(await savedLocale(jane)).toBeNull();
    expect(languageCookies(setCookie)).toEqual([]);
  });

  it('saves the language picked in the browser for an account on Default', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = passwordSignIn(
      { cookie: 'adiutor.locale=nl-NL' },
      { sessionId, userId: jane },
    );

    await afterPasswordSignIn(ctx);

    expect(await savedLocale(jane)).toBe('nl-NL');
    // The browser already has it.
    expect(languageCookies(setCookie)).toEqual([]);
  });

  it('ignores a language cookie that is not one of the languages', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    const { ctx } = passwordSignIn({ cookie: 'adiutor.locale=fr-FR' }, { sessionId, userId: jane });

    await afterPasswordSignIn(ctx);

    expect(await savedLocale(jane)).toBeNull();
  });

  it("gives the browser the account's language over the one it was using", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await setUserLocale(db, jane, 'es-ES');
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = passwordSignIn(
      { cookie: 'adiutor.locale=nl-NL', 'accept-language': 'nl-NL' },
      { sessionId, userId: jane },
    );

    await afterPasswordSignIn(ctx);

    expect(await savedLocale(jane)).toBe('es-ES');
    expect(languageCookies(setCookie)).toEqual(['es-ES']);
    expect(setCookie).toHaveBeenCalledWith(
      'adiutor.locale',
      'es-ES',
      expect.objectContaining({ path: '/', httpOnly: false, sameSite: 'lax' }),
    );
  });

  it('changes nothing for a password whose code step is still to come', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    // The app's reactions see the session before the two-step plugin deletes it; the plugin
    // listed after it sees none.
    const before = passwordSignIn({ cookie: 'adiutor.locale=es-ES' }, { sessionId, userId: jane });
    await afterAuthRequest(before.ctx);
    const after = passwordSignIn({ cookie: 'adiutor.locale=es-ES' }, null);
    await afterPasswordSignIn(after.ctx);

    expect(await savedLocale(jane)).toBeNull();
    expect(languageCookies(before.setCookie)).toEqual([]);
    expect(languageCookies(after.setCookie)).toEqual([]);
  });

  it('does the same for a sign-in with a provider', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await setUserLocale(db, jane, 'es-ES');
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = githubCallback(new Headers({ 'accept-language': 'nl-NL' }), {
      sessionId,
      userId: jane,
    });

    await afterAuthRequest(ctx);

    expect(languageCookies(setCookie)).toEqual(['es-ES']);
  });
});
