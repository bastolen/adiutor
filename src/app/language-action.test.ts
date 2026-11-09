/**
 * @file Tests for the server action that remembers the browser's language.
 */
import { cookies } from 'next/headers';
import { describe, expect, it, vi } from 'vitest';

import setLanguageAction from './language-action';

/** Stands in for the response's cookie store. */
const set = vi.fn();

vi.mock('@/lib/env', () => ({ appUrl: 'https://adiutor.dev' }));

vi.mock('next/headers', () => ({
  /**
   * The response's cookies.
   *
   * @returns A store that records what's set.
   */
  cookies: vi.fn(async () => ({ set })),
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

  it.each(['fr-FR', '', null, { locale: 'nl-NL' }])('refuses %j', async (value) => {
    set.mockClear();
    await expect(setLanguageAction(value)).resolves.toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});
