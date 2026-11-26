/**
 * @file The brand colours a staff Admin chose (decision 0049): the
 * `brand.*` settings, read for every page (the root layout) and every email.
 * Imports no server-only code, so the emails Better Auth sends can load it
 * too.
 */
import type { DatabaseOrTransaction } from '@/db';
import { type BrandColours, type HexColour, isHexColour } from '@/lib/branding';

import { readSettings } from '../settings';

/**
 * A stored brand colour as branding takes it: the schema already checked it,
 * so anything else (which it can't be) counts as the theme's own.
 *
 * @param value - The setting's value.
 * @returns The colour, or `null`.
 */
function colourOf(value: string | null): HexColour | null {
  return isHexColour(value) ? value : null;
}

/**
 * Loads the brand colours.
 *
 * @param db - Database client or transaction.
 * @returns The accent, the dark accent and the tint; `null` for each the theme keeps.
 */
export default async function loadBrandColours(db: DatabaseOrTransaction): Promise<BrandColours> {
  const settings = await readSettings(db, ['brand.accent', 'brand.accent_dark', 'brand.tint']);
  return {
    accent: colourOf(settings['brand.accent']),
    accentDark: colourOf(settings['brand.accent_dark']),
    tint: colourOf(settings['brand.tint']),
  };
}
