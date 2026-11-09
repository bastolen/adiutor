/**
 * @file Integration tests for Adiutor's default language and the language of
 * a request known by its headers.
 */
import { describe, expect, it } from 'vitest';

import { loadDefaultLocale, localeFromHeaders } from './default-locale';
import { createStaffSettings, setupTestContext } from '../../../tests/integration/helpers';

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
});
