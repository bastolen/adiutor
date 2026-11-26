/**
 * @file Tests for the palette worked out from brand colours: nothing chosen
 * is the theme, the theme's own ink as a tint gives the theme's greys back,
 * every tint and accent keeps every rule in both modes, and the accent moves
 * only when the rules need it.
 */
import { describe, expect, it } from 'vitest';

import { hexToOklch, maxChroma, oklchToHex } from './colour-space';
import type { HexColour } from './contrast';
import {
  ACCENT_TOKENS,
  type BrandColours,
  derivePalette,
  NO_BRAND_COLOURS,
  THEME_PANEL,
  TINTED_TOKENS,
} from './palette';
import { brokenRules } from './rules';
import { THEME_MODES, THEME_PALETTE, THEME_TOKENS } from './theme-colours';

/**
 * The distance between two colours in OKLab, where 0.02 is about the
 * smallest difference people notice side by side.
 *
 * @param a - One colour.
 * @param b - The other.
 * @returns The distance.
 */
function distance(a: HexColour, b: HexColour): number {
  const [x, y] = [hexToOklch(a), hexToOklch(b)];
  const ax = x.c * Math.cos((x.h * Math.PI) / 180);
  const ay = x.c * Math.sin((x.h * Math.PI) / 180);
  const bx = y.c * Math.cos((y.h * Math.PI) / 180);
  const by = y.c * Math.sin((y.h * Math.PI) / 180);
  return Math.hypot(x.l - y.l, ax - bx, ay - by);
}

/**
 * Colourful colours at every 15° of hue.
 *
 * @param l - Their lightness.
 * @param c - Their chroma, lowered where sRGB can't show it.
 * @returns 24 colours.
 */
function hues(l: number, c: number): HexColour[] {
  return Array.from({ length: 24 }, (_, index) => oklchToHex({ l, c, h: index * 15 }));
}

/** Tints of every hue, and greys from black to white. */
const TINTS: HexColour[] = [...hues(0.5, 0.2), '#000000', '#808080', '#ffffff', '#f13800'];

/** Accents of every hue, dark, middling and light, and the extremes. */
const ACCENTS: HexColour[] = [
  ...hues(0.3, 0.15),
  ...hues(0.6, 0.2),
  ...hues(0.9, 0.15),
  '#000000',
  '#ffffff',
  '#ffff00',
  '#808080',
];

describe('derivePalette', () => {
  it('is the theme itself when no brand colours are chosen', () => {
    expect(derivePalette(NO_BRAND_COLOURS)).toEqual({
      palette: THEME_PALETTE,
      overlay: { light: '#0e0e2d80', dark: '#03030cb8' },
      panel: THEME_PANEL,
      adjusted: { light: false, dark: false },
    });
  });

  it('gives the theme’s greys back, within what anyone could see, for the theme’s own ink as a tint', () => {
    const { palette } = derivePalette({ ...NO_BRAND_COLOURS, tint: '#0e0e2d' });
    THEME_MODES.forEach((mode) => {
      THEME_TOKENS.forEach((token) => {
        expect(distance(palette[mode][token], THEME_PALETTE[mode][token])).toBeLessThan(0.02);
      });
    });
  });

  it('turns the greys grey for a grey tint, and leaves the accent and statuses alone', () => {
    const { palette } = derivePalette({ ...NO_BRAND_COLOURS, tint: '#808080' });
    THEME_MODES.forEach((mode) => {
      TINTED_TOKENS.forEach((token) => {
        expect(hexToOklch(palette[mode][token]).c).toBeLessThan(0.002);
      });
      (['primary', 'highlight', 'danger', 'success', 'warning', 'code-keyword'] as const).forEach(
        (token) => {
          expect(palette[mode][token]).toBe(THEME_PALETTE[mode][token]);
        },
      );
    });
  });

  it('keeps dark greys greys in a warm tint, with a hint of its hue rather than its full colour', () => {
    const { palette } = derivePalette({ ...NO_BRAND_COLOURS, tint: '#8a6d3b' });
    (['background', 'surface', 'raised'] as const).forEach((token) => {
      const { l, c, h } = hexToOklch(palette.dark[token]);
      expect(c).toBeLessThanOrEqual(0.61 * maxChroma(l, h));
    });
  });

  it('gives the greys the tint’s hue', () => {
    const { palette } = derivePalette({ ...NO_BRAND_COLOURS, tint: '#f13800' });
    expect(hexToOklch(palette.dark.surface).h).toBeCloseTo(hexToOklch('#f13800').h, -1);
    expect(hexToOklch(palette.light.foreground).h).toBeCloseTo(hexToOklch('#f13800').h, -1);
  });

  it.each(TINTS)('keeps every rule in both modes with the tint %s', (tint) => {
    expect(brokenRules(derivePalette({ ...NO_BRAND_COLOURS, tint }).palette)).toEqual([]);
  });

  it.each(ACCENTS)('keeps every rule in both modes with the accent %s', (accent) => {
    expect(brokenRules(derivePalette({ ...NO_BRAND_COLOURS, accent }).palette)).toEqual([]);
  });

  it('keeps every rule for every tint with a spread of accents, and dark accents of their own', () => {
    const broken = TINTS.flatMap((tint) =>
      ACCENTS.filter((_, index) => index % 7 === 0).flatMap((accent) => {
        const brands: BrandColours[] = [
          { accent, accentDark: null, tint },
          { accent, accentDark: '#c0ffee', tint },
          { accent, accentDark: '#1a1a1a', tint },
        ];
        return brands.flatMap((brand) =>
          brokenRules(derivePalette(brand).palette).map(({ rule, mode }) => ({
            brand,
            rule,
            mode,
          })),
        );
      }),
    );
    expect(broken).toEqual([]);
  });

  it('keeps an accent that already keeps the rules as it is', () => {
    const result = derivePalette({ ...NO_BRAND_COLOURS, accent: '#0e5655', accentDark: '#25dc89' });
    expect(result.palette.light.primary).toBe('#0e5655');
    expect(result.palette.dark.primary).toBe('#25dc89');
    expect(result.adjusted).toEqual({ light: false, dark: false });
  });

  it('darkens a light accent in light mode, and says so', () => {
    const result = derivePalette({ ...NO_BRAND_COLOURS, accent: '#ffd400' });
    expect(result.adjusted.light).toBe(true);
    expect(hexToOklch(result.palette.light.primary).l).toBeLessThan(hexToOklch('#ffd400').l);
    expect(hexToOklch(result.palette.light.primary).h).toBeCloseTo(hexToOklch('#ffd400').h, -1);
    expect(result.adjusted.dark).toBe(false);
    expect(result.palette.dark.primary).toBe('#ffd400');
  });

  it('lightens a dark accent for dark mode when no dark accent is chosen, keeping it as vivid', () => {
    const result = derivePalette({ ...NO_BRAND_COLOURS, accent: '#0e5655' });
    expect(result.adjusted).toEqual({ light: false, dark: true });
    const chosen = hexToOklch('#0e5655');
    const shown = hexToOklch(result.palette.dark.primary);
    expect(shown.l).toBeGreaterThan(chosen.l);
    expect(shown.c / maxChroma(shown.l, shown.h)).toBeCloseTo(
      chosen.c / maxChroma(chosen.l, chosen.h),
      1,
    );
  });

  it('uses the dark accent in dark mode only', () => {
    const result = derivePalette({ ...NO_BRAND_COLOURS, accent: '#c2185b', accentDark: '#25dc89' });
    expect(result.palette.dark.primary).toBe('#25dc89');
    expect(result.palette.light.primary).toBe('#c2185b');
  });

  it('sets the accent tokens together: links and focus rings in the accent, hover a step away', () => {
    const { palette } = derivePalette({ ...NO_BRAND_COLOURS, accent: '#c2185b' });
    THEME_MODES.forEach((mode) => {
      expect(palette[mode].highlight).toBe(palette[mode].primary);
      expect(palette[mode].ring).toBe(palette[mode].primary);
      expect(palette[mode]['primary-hover']).not.toBe(palette[mode].primary);
    });
    expect(ACCENT_TOKENS).toContain('primary-foreground');
  });

  it('writes white or the darkest grey on the accent, whichever reads better', () => {
    expect(
      derivePalette({ ...NO_BRAND_COLOURS, accent: '#1d63dc' }).palette.light['primary-foreground'],
    ).toBe('#ffffff');
    expect(
      derivePalette({ ...NO_BRAND_COLOURS, accent: '#25dc89' }).palette.dark['primary-foreground'],
    ).toBe(THEME_PALETTE.dark['danger-foreground']);
  });

  it('tints the overlay behind dialogs with the greys', () => {
    const { overlay } = derivePalette({ ...NO_BRAND_COLOURS, tint: '#f13800' });
    expect(overlay.light).toMatch(/^#[0-9a-f]{6}80$/);
    expect(overlay.dark).toMatch(/^#[0-9a-f]{6}b8$/);
    expect(overlay.light).not.toBe('#0e0e2d80');
  });

  it('gives the brand panel the darkest grey, with glows in the accent of each mode', () => {
    const { palette, panel } = derivePalette({
      accent: '#c2185b',
      accentDark: '#ff80ab',
      tint: '#2e7d32',
    });
    expect(panel).toEqual({
      background: palette.light.foreground,
      glow: palette.dark.primary,
      glowDeep: palette.light.primary,
    });
    expect(derivePalette({ ...NO_BRAND_COLOURS, tint: '#2e7d32' }).panel.glow).toBe(
      THEME_PANEL.glow,
    );
    expect(derivePalette({ ...NO_BRAND_COLOURS, accent: '#c2185b' }).panel.background).toBe(
      THEME_PANEL.background,
    );
  });
});
