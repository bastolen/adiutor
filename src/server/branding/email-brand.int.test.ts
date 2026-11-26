/**
 * @file Integration tests for the brand emails are sent in, against the test
 * database: the theme's own colours before any are chosen, the chosen
 * accent's light palette after, and the theme's own when the colours can't
 * be read.
 */
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_EMAIL_COLOURS, emailColoursOf } from '@/components/email/theme';
import type { Database } from '@/db';
import { derivePalette, NO_BRAND_COLOURS } from '@/lib/branding';

import { saveSettings, setupTestContext } from '../../../tests/integration/helpers';
import loadEmailBrand from './email-brand';

const { db } = setupTestContext();

describe('loadEmailBrand', () => {
  it('gives the theme’s own colours before any are chosen', async () => {
    const brand = await loadEmailBrand(db);

    expect(brand.colours).toEqual(DEFAULT_EMAIL_COLOURS);
    expect(brand.colours).toEqual(emailColoursOf(derivePalette(NO_BRAND_COLOURS)));
  });

  it('gives the light palette of the chosen accent', async () => {
    await saveSettings(db, { 'brand.accent': '#c2185b' });

    const brand = await loadEmailBrand(db);

    expect(brand.colours).toEqual(
      emailColoursOf(derivePalette({ accent: '#c2185b', accentDark: null, tint: null })),
    );
    expect(brand.colours.primary).not.toBe(DEFAULT_EMAIL_COLOURS.primary);
  });

  it('gives the theme’s own colours when the colours can’t be read, so the email still goes out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = {
      /**
       * Fails as a database that's down does.
       *
       * @throws {Error} Always.
       */
      select: () => {
        throw new Error('the database is down');
      },
    } as unknown as Database;

    expect((await loadEmailBrand(failing)).colours).toEqual(DEFAULT_EMAIL_COLOURS);
    expect(warn).toHaveBeenCalledWith(
      'The brand colours could not be read; an email uses the theme’s colours.',
    );
    warn.mockRestore();
  });
});
