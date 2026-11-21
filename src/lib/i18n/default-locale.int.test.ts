/**
 * @file Integration tests for Adiutor's default language and the language of
 * a request known by its headers.
 */
import { describe, expect, it } from 'vitest';

import { createStaffSettings, setupTestContext } from '../../../tests/integration/helpers';
import { loadDefaultLocale, loadLanguageSettings, localeFromHeaders } from './default-locale';

const { db } = setupTestContext();

describe('loadDefaultLocale', () => {
  it('reads the default language from the staff settings', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');

    expect(await loadDefaultLocale(db)).toBe('es-ES');
  });

  it('has none before setup', async () => {
    expect(await loadDefaultLocale(db)).toBeNull();
  });
});

describe('loadLanguageSettings', () => {
  it('reads the default and the languages offered, in menu order', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES', ['es-ES', 'en-US']);

    expect(await loadLanguageSettings(db)).toEqual({
      defaultLocale: 'es-ES',
      offered: ['en-US', 'es-ES'],
    });
  });

  it('offers every language before setup', async () => {
    expect(await loadLanguageSettings(db)).toEqual({
      defaultLocale: null,
      offered: ['en-US', 'nl-NL', 'es-ES'],
    });
  });
});

describe('localeFromHeaders', () => {
  it('prefers the language cookie', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');
    const headers = new Headers({ cookie: 'adiutor.locale=nl-NL', 'accept-language': 'en-US' });

    expect(await localeFromHeaders(headers, db)).toBe('nl-NL');
  });

  it("takes Adiutor's default over what the browser asks for", async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');

    expect(await localeFromHeaders(new Headers({ 'accept-language': 'nl-NL' }), db)).toBe('es-ES');
    expect(await localeFromHeaders(null, db)).toBe('es-ES');
  });

  it('follows the browser before setup, then English (US)', async () => {
    expect(await localeFromHeaders(new Headers({ 'accept-language': 'nl-BE' }), db)).toBe('nl-NL');
    expect(await localeFromHeaders(new Headers({ 'accept-language': 'fr-FR' }), db)).toBe('en-US');
  });

  it('ignores the cookie of a language that’s turned off', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES', ['en-US', 'es-ES']);

    expect(await localeFromHeaders(new Headers({ cookie: 'adiutor.locale=nl-NL' }), db)).toBe(
      'es-ES',
    );
    expect(await localeFromHeaders(new Headers({ cookie: 'adiutor.locale=en-US' }), db)).toBe(
      'en-US',
    );
  });
});
