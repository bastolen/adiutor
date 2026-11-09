/**
 * @file Integration tests for which language an email goes out in.
 */
import { describe, expect, it } from 'vitest';

import recipientLocale from './recipient-locale';
import { createStaffSettings, setupTestContext } from '../../tests/integration/helpers';

const { db } = setupTestContext();

/**
 * The request's language.
 *
 * @returns Spanish.
 */
const spanishRequest = async () => 'es-ES' as const;

describe('recipientLocale', () => {
  it('prefers the language the recipient saved', async () => {
    expect(await recipientLocale({ db, requestLocale: spanishRequest }, 'nl-NL')).toBe('nl-NL');
  });

  it('falls back on the request’s language for someone who saved none, or something unknown', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'nl-NL');
    const ctx = { db, requestLocale: spanishRequest };

    expect(await recipientLocale(ctx, null)).toBe('es-ES');
    expect(await recipientLocale(ctx)).toBe('es-ES');
    expect(await recipientLocale(ctx, 'fr-FR')).toBe('es-ES');
  });

  it('falls back on Adiutor’s default language outside a request, or when the request can’t say', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'nl-NL');

    expect(await recipientLocale({ db }, null)).toBe('nl-NL');
    expect(
      await recipientLocale(
        {
          db,
          /**
           * Fails, as reading cookies outside a request does.
           *
           * @returns Never.
           */
          requestLocale: async () => {
            throw new Error('Not in a request');
          },
        },
        null,
      ),
    ).toBe('nl-NL');
  });

  it('falls back on English (US) before setup', async () => {
    expect(await recipientLocale({ db }, null)).toBe('en-US');
  });
});
