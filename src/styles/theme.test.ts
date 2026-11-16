/**
 * @file Contrast checks for the colour tokens of raised layers (dialogs,
 * menus, selects, toasts) in `theme.css`, in light and dark mode: text on
 * them stays readable (WCAG AA), the outline of the item the keyboard is on
 * shows where its fill doesn't, and in dark mode they sit a step lighter
 * than the page's surfaces so they stand apart.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { defined } from '@/lib/defined';

/** The theme's source. */
const THEME = readFileSync(path.join(import.meta.dirname, 'theme.css'), 'utf8');

/** The brand colours (`--color-*`) the mode-aware tokens refer to. */
const BRAND = Object.fromEntries(
  [...THEME.matchAll(/--(color-[a-z-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, hex]) => [name, hex]),
);

/**
 * Reads a mode-aware token's colour in one mode, resolving a brand colour it
 * refers to.
 *
 * @param token - The token, e.g. `raised`.
 * @param mode - Light or dark.
 * @returns Its colour, as `#rrggbb`.
 */
function colourOf(token: string, mode: 'light' | 'dark'): string {
  const match = THEME.match(new RegExp(`--${token}:\\s*light-dark\\(([^,]+),\\s*([^)]+\\)?)\\);`));
  if (!match) {
    throw new Error(`No light-dark() token --${token}`);
  }
  const value = defined(
    mode === 'light' ? match[1] : match[2],
    `the ${mode} value of --${token}`,
  ).trim();
  const brand = value.match(/^var\(--(color-[a-z-]+)\)$/);
  const hex = brand ? BRAND[defined(brand[1], 'the brand colour name')] : value;
  // Short hex (#fff) as six digits.
  return hex.length === 4 ? `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}` : hex;
}

/**
 * A colour's relative luminance (WCAG 2).
 *
 * @param hex - The colour, as `#rrggbb`.
 * @returns Its luminance, from 0 (black) to 1 (white).
 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * defined(r, 'the red channel') +
    0.7152 * defined(g, 'the green channel') +
    0.0722 * defined(b, 'the blue channel')
  );
}

/**
 * The contrast ratio between two colours (WCAG 2).
 *
 * @param a - One colour.
 * @param b - The other.
 * @returns The ratio, from 1 to 21.
 */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (
    (defined(light, 'the lighter luminance') + 0.05) /
    (defined(dark, 'the darker luminance') + 0.05)
  );
}

describe.each(['light', 'dark'] as const)('raised layers in %s mode', (mode) => {
  it.each([
    ['foreground', 'raised'],
    ['muted-foreground', 'raised'],
    ['highlight', 'raised'],
    ['danger', 'raised'],
    ['foreground', 'raised-muted'],
    ['muted-foreground', 'raised-muted'],
  ])('keep %s readable on %s (4.5:1 or more)', (text, layer) => {
    expect(contrast(colourOf(text, mode), colourOf(layer, mode))).toBeGreaterThanOrEqual(4.5);
  });

  it('keep control borders visible on them (3:1 or more)', () => {
    expect(
      contrast(colourOf('border-strong', mode), colourOf('raised', mode)),
    ).toBeGreaterThanOrEqual(3);
  });

  it('mark the highlighted item with an outline, since its fill barely differs from the layer', () => {
    // The fill of the item the keyboard is on (`highlightedItem`) is no cue by itself...
    expect(contrast(colourOf('raised-muted', mode), colourOf('raised', mode))).toBeLessThan(3);
    // ...so its outline, in the ring colour, has to show against the fill and the layer.
    expect(contrast(colourOf('ring', mode), colourOf('raised-muted', mode))).toBeGreaterThanOrEqual(
      3,
    );
    expect(contrast(colourOf('ring', mode), colourOf('raised', mode))).toBeGreaterThanOrEqual(3);
  });
});

describe('raised layers in dark mode', () => {
  it('sit a step lighter than the surfaces they open over, and their fills lighter again', () => {
    expect(luminance(colourOf('raised', 'dark'))).toBeGreaterThan(
      luminance(colourOf('surface', 'dark')),
    );
    expect(luminance(colourOf('raised', 'dark'))).toBeGreaterThan(
      luminance(colourOf('muted', 'dark')),
    );
    expect(luminance(colourOf('raised-muted', 'dark'))).toBeGreaterThan(
      luminance(colourOf('raised', 'dark')),
    );
  });
});
