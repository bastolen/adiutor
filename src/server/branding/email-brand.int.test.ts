/**
 * @file Integration tests for the brand emails are sent in, against the test
 * database: the theme's own colours before any are chosen, the chosen
 * accent's light palette after, the uploaded logo, and the theme's own when
 * the brand can't be read.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_EMAIL_COLOURS, emailColoursOf } from '@/components/email/theme';
import type { Database } from '@/db';
import { derivePalette, NO_BRAND_COLOURS } from '@/lib/branding';

import { saveSettings, setupTestContext, staffActor } from '../../../tests/integration/helpers';
import { setBrandImage } from './brand-images';
import loadEmailBrand from './email-brand';

const { ctx, db } = setupTestContext();

describe('loadEmailBrand', () => {
  it('gives the theme’s own colours, and Adiutor’s name, before any are chosen', async () => {
    const brand = await loadEmailBrand(db);

    expect(brand.name).toBe('Adiutor');
    expect(brand.colours).toEqual(DEFAULT_EMAIL_COLOURS);
    expect(brand.colours).toEqual(emailColoursOf(derivePalette(NO_BRAND_COLOURS)));
  });

  it('gives the staff’s name once they have one', async () => {
    await saveSettings(db, { 'staff.name': 'Adiutor Tests Support' });

    expect((await loadEmailBrand(db)).name).toBe('Adiutor Tests Support');
  });

  it('gives the light palette of the chosen accent', async () => {
    await saveSettings(db, { 'brand.accent': '#c2185b' });

    const brand = await loadEmailBrand(db);

    expect(brand.colours).toEqual(
      emailColoursOf(derivePalette({ accent: '#c2185b', accentDark: null, tint: null })),
    );
    expect(brand.colours.primary).not.toBe(DEFAULT_EMAIL_COLOURS.primary);
  });

  it('gives no logo, Adiutor’s, until one is uploaded, and the uploaded one’s address and size after', async () => {
    expect((await loadEmailBrand(db)).logo).toBeUndefined();

    const admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
    const logo = await setBrandImage(ctx, admin, 'logo', readFileSync('public/brand/logo.png'));

    expect((await loadEmailBrand(db)).logo).toEqual({
      src: `/branding/logo?v=${logo.id}`,
      width: 280,
      height: 64,
    });
  });

  it('gives Adiutor’s colours, name and logo when the brand can’t be read, so the email still goes out', async () => {
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

    expect(await loadEmailBrand(failing)).toEqual({
      colours: DEFAULT_EMAIL_COLOURS,
      name: 'Adiutor',
    });
    expect(warn).toHaveBeenCalledWith(
      'The brand could not be read; an email uses Adiutor’s colours, name and logo.',
    );
    warn.mockRestore();
  });
});
