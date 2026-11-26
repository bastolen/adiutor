/**
 * @file Tests for the rules every palette keeps: they find what a palette
 * breaks, in the mode it breaks it, and nothing in the theme's own colours.
 */
import { describe, expect, it } from 'vitest';

import { brokenRules, colourIn, PALETTE_RULES, ruleHolds } from './rules';
import { THEME_PALETTE } from './theme-colours';

describe('brokenRules', () => {
  it('finds nothing in the theme’s own colours', () => {
    expect(brokenRules(THEME_PALETTE)).toEqual([]);
  });

  it('finds secondary text that has become unreadable, in the mode where it has', () => {
    const palette = {
      ...THEME_PALETTE,
      dark: { ...THEME_PALETTE.dark, 'muted-foreground': '#3a3a60' as const },
    };
    const broken = brokenRules(palette);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every(({ mode }) => mode === 'dark')).toBe(true);
    expect(broken.every(({ rule }) => rule.text === 'muted-foreground')).toBe(true);
  });

  it('finds raised layers that are no lighter than the surfaces under them in dark mode', () => {
    const palette = {
      ...THEME_PALETTE,
      dark: { ...THEME_PALETTE.dark, raised: '#101030' as const },
    };
    expect(brokenRules(palette)).toContainEqual({
      rule: { kind: 'lighter', text: 'raised', on: 'surface', modes: ['dark'] },
      mode: 'dark',
    });
  });

  it('checks only the rules it is given', () => {
    const palette = {
      ...THEME_PALETTE,
      light: { ...THEME_PALETTE.light, ring: '#ffffff' as const },
    };
    const others = PALETTE_RULES.filter((rule) => rule.text !== 'ring');
    expect(brokenRules(palette, others)).toEqual([]);
    expect(brokenRules(palette).length).toBeGreaterThan(0);
  });
});

describe('ruleHolds', () => {
  it('measures a fixed colour as well as a token', () => {
    const rule = {
      kind: 'contrast',
      text: '#ffffff',
      on: 'primary',
      min: 4.5,
      modes: ['light'],
    } as const;
    expect(colourIn(THEME_PALETTE.light, '#ffffff')).toBe('#ffffff');
    expect(ruleHolds(rule, THEME_PALETTE.light)).toBe(true);
    expect(ruleHolds({ ...rule, on: 'surface' }, THEME_PALETTE.light)).toBe(false);
  });
});
