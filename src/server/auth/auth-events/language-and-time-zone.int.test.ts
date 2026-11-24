/**
 * @file Integration tests for the language and time zone at sign-in: the
 * browser gets the account's language and zone, an account on Default saves
 * no language (not a guessed one, and not the one left in the browser, which
 * is removed), an account without a zone gets none (and one left in the
 * browser is removed), and a password whose code step is still to come
 * changes nothing.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { user } from '@/db/schema';

import {
  createSession,
  createStaffSettings,
  createUser,
  setUserLocale,
  savedLocale,
  savedTimeZone,
} from '../../../../tests/integration/helpers';
import { afterAuthRequest } from './after-request';
import { afterPasswordSignIn } from './password-sign-in';
import { db, githubCallback, passwordSignIn } from './test-helpers';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: vi.fn(),
  getOAuthState: vi.fn(),
}));

/**
 * The language cookies a request set.
 *
 * @param setCookie - The request's `setCookie` mock.
 * @returns The values it set the language cookie to.
 */
const languageCookies = (setCookie: ReturnType<typeof passwordSignIn>['setCookie']) =>
  setCookie.mock.calls.filter(([name]) => name === 'adiutor.locale').map(([, value]) => value);

/** How a request removes the language cookie from the browser: emptied and expired, on every path. */
const REMOVED = ['adiutor.locale', '', expect.objectContaining({ maxAge: 0, path: '/' })] as const;

describe('the language at sign-in', () => {
  it("keeps an account on Default as it is in a browser without a language cookie: neither the browser's language nor Adiutor's default is saved", async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = passwordSignIn(
      { 'accept-language': 'nl-BE,nl;q=0.9' },
      { sessionId, userId: jane },
    );

    await afterPasswordSignIn(ctx);

    expect(await savedLocale(db, jane)).toBeNull();
    expect(languageCookies(setCookie)).toEqual([]);
  });

  it('saves nothing for an account on Default, and removes the language left in the browser', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    // Left by whoever used this browser before: signing out keeps the language cookie.
    const { ctx, setCookie } = passwordSignIn(
      { cookie: 'other=1; adiutor.locale=nl-NL' },
      { sessionId, userId: jane },
    );

    await afterPasswordSignIn(ctx);

    expect(await savedLocale(db, jane)).toBeNull();
    // The browser follows Adiutor's default language from here, like the account.
    expect(languageCookies(setCookie)).toEqual(['']);
    expect(setCookie).toHaveBeenCalledWith(...REMOVED);
  });

  it('removes a language cookie that is not one of the languages too', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = passwordSignIn(
      { cookie: 'adiutor.locale=fr-FR' },
      { sessionId, userId: jane },
    );

    await afterPasswordSignIn(ctx);

    expect(await savedLocale(db, jane)).toBeNull();
    expect(setCookie).toHaveBeenCalledWith(...REMOVED);
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

    expect(await savedLocale(db, jane)).toBe('es-ES');
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

    expect(await savedLocale(db, jane)).toBeNull();
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

  it('removes a language left in the browser at a provider sign-in of an account on Default', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = githubCallback(new Headers({ cookie: 'adiutor.locale=nl-NL' }), {
      sessionId,
      userId: jane,
    });

    await afterAuthRequest(ctx);

    expect(await savedLocale(db, jane)).toBeNull();
    expect(setCookie).toHaveBeenCalledWith(...REMOVED);
  });
});

/**
 * The values a request set the time zone cookie to.
 *
 * @param setCookie - The request's `setCookie` mock.
 * @returns The values, in order.
 */
const zoneCookies = (setCookie: ReturnType<typeof passwordSignIn>['setCookie']) =>
  setCookie.mock.calls.filter(([name]) => name === 'adiutor.time-zone').map(([, value]) => value);

describe('the time zone at sign-in', () => {
  it("gives the browser the account's zone over the one it had", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ timeZone: 'Asia/Kolkata' }).where(eq(user.id, jane));
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = passwordSignIn(
      { cookie: 'adiutor.time-zone=Europe/Amsterdam' },
      { sessionId, userId: jane },
    );

    await afterPasswordSignIn(ctx);

    expect(zoneCookies(setCookie)).toEqual(['Asia/Kolkata']);
    expect(setCookie).toHaveBeenCalledWith(
      'adiutor.time-zone',
      'Asia/Kolkata',
      expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('saves nothing for an account without a zone, and removes the one left in the browser', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = passwordSignIn(
      { cookie: 'adiutor.time-zone=Europe/Amsterdam' },
      { sessionId, userId: jane },
    );

    await afterPasswordSignIn(ctx);

    expect(await savedTimeZone(db, jane)).toBeNull();
    expect(setCookie).toHaveBeenCalledWith(
      'adiutor.time-zone',
      '',
      expect.objectContaining({ maxAge: 0, path: '/' }),
    );
  });

  it('sets no cookie for an account without a zone in a browser without one', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = passwordSignIn({}, { sessionId, userId: jane });

    await afterPasswordSignIn(ctx);

    expect(zoneCookies(setCookie)).toEqual([]);
  });

  it('changes nothing for a password whose code step is still to come', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ timeZone: 'Asia/Kolkata' }).where(eq(user.id, jane));
    const sessionId = await createSession(db, jane);
    const before = passwordSignIn({}, { sessionId, userId: jane });
    await afterAuthRequest(before.ctx);
    const after = passwordSignIn({}, null);
    await afterPasswordSignIn(after.ctx);

    expect(zoneCookies(before.setCookie)).toEqual([]);
    expect(zoneCookies(after.setCookie)).toEqual([]);
  });

  it('does the same for a sign-in with a provider', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ timeZone: 'America/New_York' }).where(eq(user.id, jane));
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = githubCallback(new Headers(), { sessionId, userId: jane });

    await afterAuthRequest(ctx);

    expect(zoneCookies(setCookie)).toEqual(['America/New_York']);
  });
});
