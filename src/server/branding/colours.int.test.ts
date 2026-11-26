/**
 * @file Integration tests for reading the brand colours, against the test
 * database: the theme's own before any are chosen, the chosen ones after,
 * a dark accent on its own, and nothing for a stored value that isn't a
 * colour.
 */
import { describe, expect, it } from 'vitest';

import { setting } from '@/db/schema';
import { NO_BRAND_COLOURS } from '@/lib/branding';

import { saveSettings, setupTestContext } from '../../../tests/integration/helpers';
import loadBrandColours from './colours';

const { db } = setupTestContext();

describe('loadBrandColours', () => {
  it('gives the theme’s own colours before any are chosen', async () => {
    expect(await loadBrandColours(db)).toEqual(NO_BRAND_COLOURS);
  });

  it('gives the colours that were chosen', async () => {
    await saveSettings(db, {
      'brand.accent': '#c2185b',
      'brand.accent_dark': '#ff80ab',
      'brand.tint': '#2e7d32',
    });

    expect(await loadBrandColours(db)).toEqual({
      accent: '#c2185b',
      accentDark: '#ff80ab',
      tint: '#2e7d32',
    });
  });

  it('gives a dark accent on its own', async () => {
    await saveSettings(db, { 'brand.accent_dark': '#ff80ab' });

    expect(await loadBrandColours(db)).toEqual({ ...NO_BRAND_COLOURS, accentDark: '#ff80ab' });
  });

  it('ignores a stored value that isn’t a colour', async () => {
    await db.insert(setting).values([{ key: 'brand.tint', value: '#2e7d32;}body{color:red' }]);

    expect(await loadBrandColours(db)).toEqual(NO_BRAND_COLOURS);
  });
});
