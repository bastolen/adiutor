/**
 * @file Tests for the server action that remembers the browser's language.
 */
import { cookies } from 'next/headers';
import { describe, expect, it, vi } from 'vitest';

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

describe('setLanguageAction', () => {
  it('sets the language cookie for a year, readable in the browser, over HTTPS', async () => {
    await expect(setLanguageAction('nl-NL')).resolves.toBe(true);

    expect(cookies).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith('adiutor.locale', 'nl-NL', {
      maxAge: 365 * 24 * 60 * 60,
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      secure: true,
    });
  });

  it('deletes the language cookie for Default, so the browser follows Adiutor’s default', async () => {
    set.mockClear();
    await expect(setLanguageAction('default')).resolves.toBe(true);

    expect(remove).toHaveBeenCalledWith('adiutor.locale');
    expect(set).not.toHaveBeenCalled();
  });

  it.each(['fr-FR', '', null, { locale: 'nl-NL' }])('refuses %j', async (value) => {
    set.mockClear();
    remove.mockClear();
    await expect(setLanguageAction(value)).resolves.toBe(false);
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
