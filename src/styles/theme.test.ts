/**
 * @file Checks the colour tokens in `theme.css`: the copy code reads
 * (`THEME_PALETTE` in `src/lib/branding`) has the same tokens and values, and
 * the theme keeps every rule a palette keeps (`PALETTE_RULES`), in light and
 * dark mode: text readable (WCAG AA) on every surface and on the fills it's
 * written on, borders of controls and focus rings visible, highlighted code
 * readable, and in dark mode raised layers a step lighter than the surfaces
 * they open over.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PALETTE_RULES,
  type PaletteRule,
  ruleHolds,
  THEME_MODES,
  THEME_PALETTE,
  THEME_TOKENS,
} from '@/lib/branding';
import { defined } from '@/lib/defined';

/** The theme's source. */
const THEME = readFileSync(path.join(import.meta.dirname, 'theme.css'), 'utf8');

/** The brand colours (`--color-*`) the mode-aware tokens refer to. */
const BRAND = Object.fromEntries(
  [...THEME.matchAll(/--(color-[a-z-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, hex]) => [name, hex]),
);

/**
 * Reads one value of a mode-aware token as `#rrggbb`, resolving a brand
 * colour it refers to and writing out short hex.
 *
 * @param value - The value in `light-dark()`, e.g. `var(--color-ink)` or `#fff`.
 * @returns The colour.
 */
function resolve(value: string): string {
  const brand = value.trim().match(/^var\(--(color-[a-z-]+)\)$/);
  const hex = (brand ? BRAND[defined(brand[1], 'the brand colour name')] : value.trim()) ?? '';
  const long =
    hex.length === 4 ? `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}` : hex;
  return long.toLowerCase();
}

/** Every `--token: light-dark(light, dark);` in the theme whose values are colours in hex. */
const MODE_AWARE = [
  ...THEME.matchAll(
    /--([a-z-]+):\s*light-dark\(((?:var\([^)]*\)|#[0-9a-f]+)),\s*((?:var\([^)]*\)|#[0-9a-f]+))\);/gi,
  ),
].map(([, token, light, dark]) => ({
  token: defined(token, 'the token'),
  light: resolve(defined(light, 'the light value')),
  dark: resolve(defined(dark, 'the dark value')),
}));

/**
 * Says what a rule checks, for the test's name.
 *
 * @param rule - The rule.
 * @returns E.g. `highlight on surface reaches 4.5:1`.
 */
function described(rule: PaletteRule): string {
  if (rule.kind === 'contrast') {
    return `${rule.text} on ${rule.on} reaches ${String(rule.min)}:1`;
  }
  if (rule.kind === 'subtle') {
    return `${rule.text} differs from ${rule.on} by less than ${String(rule.max)}:1`;
  }
  return `${rule.text} is lighter than ${rule.on}`;
}

describe('the colour tokens code reads', () => {
  it('are the mode-aware colour tokens of theme.css, with the same values', () => {
    expect(Object.fromEntries(MODE_AWARE.map(({ token, light }) => [token, light]))).toEqual(
      THEME_PALETTE.light,
    );
    expect(Object.fromEntries(MODE_AWARE.map(({ token, dark }) => [token, dark]))).toEqual(
      THEME_PALETTE.dark,
    );
    expect(MODE_AWARE.map(({ token }) => token)).toEqual([...THEME_TOKENS]);
  });
});

describe.each(THEME_MODES)('the theme in %s mode', (mode) => {
  it.each(
    PALETTE_RULES.filter((rule) => rule.modes.includes(mode)).map(
      (rule) => [described(rule), rule] as const,
    ),
  )('keeps the rule: %s', (_name, rule) => {
    expect(ruleHolds(rule, THEME_PALETTE[mode])).toBe(true);
  });
});
