/**
 * @file Tests for the server action of the theme and language menu: signed
 * out it remembers the browser's language in the cookie only; with a session
 * it saves the choice with the account too, as the Language card does, except
 * while a staff member is signed in as the user (refused, cookie untouched)
 * and for a session that still has to be confirmed (cookie only).
 */
import { cookies } from 'next/headers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestLanguageSettings } from '@/lib/i18n/request-locale';
import type { Actor } from '@/server/actor';
import { getOptionalActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import setOwnLocale from '@/server/people/own-locale';

import setLanguageAction from './language-action';

/** Stands in for the response's cookie store: setting a cookie. */
const set = vi.fn();

/** Stands in for the response's cookie store: deleting a cookie. */
const remove = vi.fn();

vi.mock('@/lib/env', () => ({ appUrl: 'https://adiutor.dev', secureCookies: true }));

vi.mock('next/headers', () => ({
  /**
   * The response's cookies.
   *
   * @returns A store that records what's set and deleted.
   */
  cookies: vi.fn(async () => ({ set, delete: remove })),
}));

vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', async () => ({
  getOptionalActor: vi.fn(),
  // The real refusal of changes while a staff member is signed in as the user.
  assertNotSignedInAs: (await import('@/server/signed-in-as')).default,
}));
vi.mock('@/server/people/own-locale', () => ({ default: vi.fn() }));

/** The MFA facts of a session that counts: nothing to confirm. */
const CONFIRMED = {
  canConfirmSessions: true,
  mfaEnabled: true,
  mfaRequired: false,
  sessionMfaVerified: true,
  signedInAs: null,
};

/**
 * Signs someone in for the next call.
 *
 * @param facts - What differs from a session that counts.
 * @returns The actor the action will find.
 */
function signedIn(facts: Partial<Actor> = {}): Actor {
  const actor = { id: 'jane-id', ...CONFIRMED, ...facts } as Actor;
  vi.mocked(getOptionalActor).mockResolvedValue(actor);
  return actor;
}

/** How the action sets the language cookie: for a year, readable in the browser, over HTTPS. */
const COOKIE_OPTIONS = {
  maxAge: 365 * 24 * 60 * 60,
  path: '/',
  httpOnly: false,
  sameSite: 'lax',
  secure: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOptionalActor).mockResolvedValue(null);
  vi.mocked(setOwnLocale).mockResolvedValue(null);
});

describe('setLanguageAction', () => {
  describe('signed out', () => {
    it('sets the language cookie for a year, readable in the browser, over HTTPS', async () => {
      await expect(setLanguageAction('nl-NL')).resolves.toBe(true);

      expect(cookies).toHaveBeenCalled();
      expect(set).toHaveBeenCalledWith('adiutor.locale', 'nl-NL', COOKIE_OPTIONS);
      // The browser's choice only: there's no account to save it with.
      expect(setOwnLocale).not.toHaveBeenCalled();
    });

    it('deletes the language cookie for Default, so the browser follows Adiutor’s default', async () => {
      await expect(setLanguageAction('default')).resolves.toBe(true);

      expect(remove).toHaveBeenCalledWith('adiutor.locale');
      expect(set).not.toHaveBeenCalled();
      expect(setOwnLocale).not.toHaveBeenCalled();
    });

    it('still changes the browser’s language when the session can’t be read', async () => {
      // On the error page, the database may be what's failing.
      vi.mocked(getOptionalActor).mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(setLanguageAction('es-ES')).resolves.toBe(true);

      expect(set).toHaveBeenCalledWith('adiutor.locale', 'es-ES', COOKIE_OPTIONS);
      expect(setOwnLocale).not.toHaveBeenCalled();
    });

    it('refuses a language that’s turned off, leaving the cookie as it was', async () => {
      vi.mocked(getOptionalActor).mockResolvedValue(null);
      vi.mocked(requestLanguageSettings).mockResolvedValueOnce({
        defaultLocale: 'en-US',
        offered: ['en-US', 'es-ES'],
      });

      await expect(setLanguageAction('nl-NL')).resolves.toBe(false);
      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });
  });

  describe('signed in', () => {
    it('saves the language with the account too, like the Language card', async () => {
      const actor = signedIn();

      await expect(setLanguageAction('nl-NL')).resolves.toBe(true);

      expect(setOwnLocale).toHaveBeenCalledWith({ name: 'app context' }, actor, 'nl-NL');
      expect(set).toHaveBeenCalledWith('adiutor.locale', 'nl-NL', COOKIE_OPTIONS);
    });

    it('saves Default with the account, and deletes the cookie', async () => {
      const actor = signedIn();

      await expect(setLanguageAction('default')).resolves.toBe(true);

      expect(setOwnLocale).toHaveBeenCalledWith({ name: 'app context' }, actor, 'default');
      expect(remove).toHaveBeenCalledWith('adiutor.locale');
      expect(set).not.toHaveBeenCalled();
    });

    it('saves it for someone whose role requires MFA they still have to set up, as the card does', async () => {
      // Nothing to confirm with yet: the account pages are open to them (`allowMissingMfa`).
      const actor = signedIn({
        canConfirmSessions: false,
        mfaEnabled: false,
        mfaRequired: true,
        sessionMfaVerified: false,
      });

      await expect(setLanguageAction('es-ES')).resolves.toBe(true);

      expect(setOwnLocale).toHaveBeenCalledWith({ name: 'app context' }, actor, 'es-ES');
    });

    it.each([
      ['whose session facts are empty, as they are then', { sessionMfaVerified: false }],
      ['without MFA', { canConfirmSessions: false, mfaEnabled: false, sessionMfaVerified: false }],
    ])(
      'is refused while a staff member is signed in as a user %s: nothing saved, the cookie untouched',
      async (_, facts) => {
        // The session is the staff member's: the user comes without one of their own.
        signedIn({ ...facts, signedInAs: { staffId: 'staff-id' } as Actor['signedInAs'] });

        await expect(setLanguageAction('nl-NL')).resolves.toBe(false);
        await expect(setLanguageAction('default')).resolves.toBe(false);

        expect(setOwnLocale).not.toHaveBeenCalled();
        expect(set).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
      },
    );

    it('is refused when the service refuses it, leaving the cookie as it was', async () => {
      signedIn();
      vi.mocked(setOwnLocale).mockRejectedValue(new ServiceError('forbidden', 'errors.forbidden'));

      await expect(setLanguageAction('nl-NL')).resolves.toBe(false);

      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });

    it('changes only the cookie for a session that still has to be confirmed with its second step', async () => {
      // On the step-up page: such a session may change nothing in the account.
      signedIn({ sessionMfaVerified: false });

      await expect(setLanguageAction('nl-NL')).resolves.toBe(true);

      expect(setOwnLocale).not.toHaveBeenCalled();
      expect(set).toHaveBeenCalledWith('adiutor.locale', 'nl-NL', COOKIE_OPTIONS);
    });

    it('lets a failure to save through, leaving the cookie as it was', async () => {
      signedIn();
      vi.mocked(setOwnLocale).mockRejectedValue(new Error('connection lost'));

      await expect(setLanguageAction('nl-NL')).rejects.toThrow('connection lost');

      expect(set).not.toHaveBeenCalled();
    });
  });

  it.each(['fr-FR', '', null, { locale: 'nl-NL' }])('refuses %j', async (value) => {
    signedIn();

    await expect(setLanguageAction(value)).resolves.toBe(false);

    expect(setOwnLocale).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
