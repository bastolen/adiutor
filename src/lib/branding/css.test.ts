/**
 * @file Tests for the CSS a palette becomes: nothing for the theme's own
 * colours, only what differs otherwise, and only hex.
 */
import { describe, expect, it } from 'vitest';

import { paletteCss, paletteVariables } from './css';
import { derivePalette, NO_BRAND_COLOURS } from './palette';
import { THEME_PALETTE } from './theme-colours';

describe('paletteCss', () => {
  it('is empty for the theme’s own colours', () => {
    expect(paletteCss(derivePalette(NO_BRAND_COLOURS))).toBe('');
  });

  it('sets only the accent’s tokens for an accent, following the colour scheme', () => {
    const css = paletteCss(
      derivePalette({ ...NO_BRAND_COLOURS, accent: '#c2185b', accentDark: '#ff80ab' }),
    );
    expect(css).toMatch(/^:root:root\{.*\}$/);
    expect(css).toContain('--primary:light-dark(#c2185b,#ff80ab);');
    expect(css).toContain('--highlight:light-dark(#c2185b,#ff80ab);');
    expect(css).not.toContain('--surface:');
    expect(css).not.toContain('--overlay:');
  });

  it('sets the greys and the overlay for a tint', () => {
    const css = paletteCss(derivePalette({ ...NO_BRAND_COLOURS, tint: '#f13800' }));
    expect(css).toContain('--background:light-dark(');
    expect(css).toContain('--overlay:light-dark(');
    expect(css).not.toContain('--danger:');
  });

  it('holds nothing but custom properties set to hex colours', () => {
    const css = paletteCss(derivePalette({ accent: '#c2185b', accentDark: null, tint: '#2e7d32' }));
    expect(css).toMatch(
      /^:root:root\{(--[a-z-]+:light-dark\(#[0-9a-f]{6,8},#[0-9a-f]{6,8}\);)+\}$/,
    );
  });

  it('refuses a colour that isn’t hex', () => {
    const brand = derivePalette(NO_BRAND_COLOURS);
    const broken = {
      ...brand,
      palette: {
        ...brand.palette,
        light: { ...brand.palette.light, primary: '#000000;}body{x:y' as const },
      },
    };
    expect(() => paletteCss(broken)).toThrow('hex');
  });
});

describe('paletteVariables', () => {
  it('gives every token of one mode as a custom property', () => {
    const variables = paletteVariables(derivePalette(NO_BRAND_COLOURS), 'dark');
    expect(variables['--surface']).toBe(THEME_PALETTE.dark.surface);
    expect(variables['--overlay']).toBe('#03030cb8');
  });
});
