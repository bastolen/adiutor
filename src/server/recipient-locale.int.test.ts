/**
 * @file Integration tests for which language an email goes out in.
 */
import { describe, expect, it } from 'vitest';

import { createStaffSettings, setupTestContext } from '../../tests/integration/helpers';
import recipientLocale, { defaultLanguage, requesterLocale } from './recipient-locale';

const { db } = setupTestContext();

/**
 * The request's language.
 *
 * @returns Spanish.
 */
const spanishRequest = async () => 'es-ES' as const;

/**
 * Fails, as reading cookies outside a request does.
 *
 * @returns Never.
 */
const noRequest = async (): Promise<never> => {
  throw new Error('Not in a request');
};

describe('recipientLocale', () => {
  it('prefers the language the recipient saved', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');
    expect(await recipientLocale({ db }, 'nl-NL')).toBe('nl-NL');
  });

  it('uses Adiutor’s default language for someone on Default, or something unknown', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'nl-NL');

    expect(await recipientLocale({ db }, null)).toBe('nl-NL');
    expect(await recipientLocale({ db })).toBe('nl-NL');
    expect(await recipientLocale({ db }, 'fr-FR')).toBe('nl-NL');
  });

  it('ignores the language of whoever caused the email', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'nl-NL');
    const fromSpanishBrowser = { db, requestLocale: spanishRequest };

    expect(await recipientLocale(fromSpanishBrowser, null)).toBe('nl-NL');
  });

  it('falls back on English (US) before setup', async () => {
    expect(await recipientLocale({ db }, null)).toBe('en-US');
    expect(await defaultLanguage({ db })).toBe('en-US');
  });

  it('skips a language that’s turned off, for the next one or the default', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES', ['en-US', 'es-ES']);

    expect(await recipientLocale({ db }, 'nl-NL')).toBe('es-ES');
    expect(await recipientLocale({ db }, 'nl-NL', 'en-US')).toBe('en-US');
  });
});

describe('requesterLocale', () => {
  it('uses the language the requester’s browser shows', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'nl-NL');
    expect(await requesterLocale({ db, requestLocale: spanishRequest })).toBe('es-ES');
  });

  it('falls back on Adiutor’s default language outside a request, or when the request can’t say', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'nl-NL');

    expect(await requesterLocale({ db })).toBe('nl-NL');
    expect(await requesterLocale({ db, requestLocale: noRequest })).toBe('nl-NL');
  });
});
