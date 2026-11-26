/**
 * @file Integration tests for reading the brand colours, against the test
 * database: the theme's own before any are chosen, the chosen ones after,
 * and a dark accent only with an accent.
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

  it('ignores a stored dark accent without an accent, and a stored value that isn’t a colour', async () => {
    await db.insert(setting).values([
      { key: 'brand.accent_dark', value: '#ff80ab' },
      { key: 'brand.tint', value: '#2e7d32;}body{color:red' },
    ]);

    expect(await loadBrandColours(db)).toEqual(NO_BRAND_COLOURS);
  });
});
