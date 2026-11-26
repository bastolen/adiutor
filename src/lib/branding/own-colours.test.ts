/**
 * @file Tests for Adiutor's own brand colours and the rule that stores a
 * colour equal to the one used anyway as none: it gives the same palette as
 * the colours as chosen, and keeps every colour that changes something.
 */
import { describe, expect, it } from 'vitest';

import { ADIUTOR_COLOURS, followedDarkAccent, storedBrandColours } from './own-colours';
import { type BrandColours, derivePalette, NO_BRAND_COLOURS, THEME_PANEL } from './palette';
import { THEME_PALETTE } from './theme-colours';

describe('ADIUTOR_COLOURS', () => {
  it('are the theme’s accents and the ink its greys take their hue from', () => {
    expect(ADIUTOR_COLOURS).toEqual({
      accent: THEME_PALETTE.light.primary,
      accentDark: THEME_PALETTE.dark.primary,
      tint: THEME_PANEL.background,
    });
  });
});

describe('followedDarkAccent', () => {
  it('is the accent, or Adiutor’s dark accent while the accent is Adiutor’s', () => {
    expect(followedDarkAccent('#c2185b')).toBe('#c2185b');
    expect(followedDarkAccent(null)).toBe(ADIUTOR_COLOURS.accentDark);
  });
});

describe('storedBrandColours', () => {
  it('stores Adiutor’s own colours as none', () => {
    expect(storedBrandColours(ADIUTOR_COLOURS)).toEqual(NO_BRAND_COLOURS);
    expect(storedBrandColours(NO_BRAND_COLOURS)).toEqual(NO_BRAND_COLOURS);
  });

  it('stores a dark accent equal to the accent as none', () => {
    expect(storedBrandColours({ accent: '#c2185b', accentDark: '#c2185b', tint: null })).toEqual({
      ...NO_BRAND_COLOURS,
      accent: '#c2185b',
    });
  });

  it('keeps every colour that changes something', () => {
    const chosen: BrandColours[] = [
      { accent: '#c2185b', accentDark: '#ff80ab', tint: '#2e7d32' },
      // Adiutor's green next to another accent.
      { accent: '#c2185b', accentDark: ADIUTOR_COLOURS.accentDark, tint: null },
      // Adiutor's teal for dark mode alone.
      { accent: null, accentDark: ADIUTOR_COLOURS.accent, tint: null },
      { accent: null, accentDark: '#ff80ab', tint: null },
    ];
    chosen.forEach((colours) => {
      expect(storedBrandColours(colours)).toEqual(colours);
    });
  });

  it('stores the dark accent alone when the accent is Adiutor’s', () => {
    expect(
      storedBrandColours({ accent: ADIUTOR_COLOURS.accent, accentDark: '#ff80ab', tint: null }),
    ).toEqual({ ...NO_BRAND_COLOURS, accentDark: '#ff80ab' });
  });

  it('gives the theme itself for Adiutor’s own colours', () => {
    expect(derivePalette(storedBrandColours(ADIUTOR_COLOURS))).toEqual(
      derivePalette(NO_BRAND_COLOURS),
    );
  });

  it('drops a dark accent equal to the accent only where the palette is the same without it', () => {
    (['#c2185b', '#ffd400', '#1d63dc'] as const).forEach((accent) => {
      ([null, '#2e7d32'] as const).forEach((tint) => {
        expect(derivePalette({ accent, accentDark: accent, tint })).toEqual(
          derivePalette(storedBrandColours({ accent, accentDark: accent, tint })),
        );
      });
    });
  });
});
