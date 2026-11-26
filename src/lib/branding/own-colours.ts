/**
 * @file Adiutor's own brand colours, which the Appearance tab's fields show
 * while none are chosen, and the rule that stores a colour equal to the one
 * used anyway as none (decision 0049): what the fields send then changes
 * nothing, pages keep no colours of their own, and a later change to the
 * theme still reaches them.
 */
import type { HexColour } from './contrast';
import { type BrandColours, THEME_PANEL } from './palette';
import { THEME_PALETTE } from './theme-colours';

/** Adiutor's own colours, as the fields show them: what each brand colour is while none is chosen. */
export const ADIUTOR_COLOURS = {
  /** The theme's accent in light mode, teal. */
  accent: THEME_PALETTE.light.primary,
  /** The theme's accent in dark mode, green. */
  accentDark: THEME_PALETTE.dark.primary,
  /** The navy ink whose hue the theme's greys have. */
  tint: THEME_PANEL.background,
} as const satisfies Record<keyof BrandColours, HexColour>;

/**
 * The colour dark mode starts from without a dark accent of its own: the
 * accent, or Adiutor's own dark accent while the accent is Adiutor's.
 *
 * @param accent - The accent as it's stored; `null` for Adiutor's.
 * @returns The colour dark mode starts from.
 */
export function followedDarkAccent(accent: HexColour | null): HexColour {
  return accent ?? ADIUTOR_COLOURS.accentDark;
}

/**
 * The brand colours as they're stored: a colour that's the one used anyway
 * is none. That's the accent when it's Adiutor's, the dark accent when it's
 * what dark mode starts from without it (`followedDarkAccent`), and the tint
 * when it's Adiutor's navy. Any other colour stays chosen, Adiutor's teal for
 * dark mode alone or its green next to another accent included.
 *
 * @param chosen - The colours as chosen; `null` for Adiutor's.
 * @returns The colours to store.
 */
export function storedBrandColours(chosen: BrandColours): BrandColours {
  const accent = chosen.accent === ADIUTOR_COLOURS.accent ? null : chosen.accent;
  return {
    accent,
    accentDark: chosen.accentDark === followedDarkAccent(accent) ? null : chosen.accentDark,
    tint: chosen.tint === ADIUTOR_COLOURS.tint ? null : chosen.tint,
  };
}
