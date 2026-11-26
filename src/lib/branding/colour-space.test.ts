/**
 * @file Tests for colours in OKLCH: conversions to and from hex, and the
 * gamut clamp that keeps a colour's lightness and hue where sRGB can't show
 * its chroma.
 */
import { describe, expect, it } from 'vitest';

import { hexToOklch, inGamut, isHexColour, maxChroma, oklchToHex } from './colour-space';

describe('isHexColour', () => {
  it('takes # and six lower-case hex digits only', () => {
    expect(isHexColour('#0e5655')).toBe(true);
    expect(isHexColour('#0E5655')).toBe(false);
    expect(isHexColour('#fff')).toBe(false);
    expect(isHexColour('0e5655')).toBe(false);
    expect(isHexColour('#0e5655;}')).toBe(false);
    expect(isHexColour(null)).toBe(false);
  });
});

describe('hexToOklch', () => {
  it('gives white full lightness and no chroma, black none of either', () => {
    expect(hexToOklch('#ffffff')).toEqual({
      l: expect.closeTo(1, 4),
      c: expect.closeTo(0, 4),
      h: 0,
    });
    expect(hexToOklch('#000000')).toEqual({ l: 0, c: 0, h: 0 });
  });

  it('reads the theme’s teal and navy ink as the colour tools do', () => {
    expect(hexToOklch('#0e5655')).toEqual({
      l: expect.closeTo(0.412, 3),
      c: expect.closeTo(0.066, 3),
      h: expect.closeTo(193, 0),
    });
    expect(hexToOklch('#0e0e2d').h).toBeCloseTo(279, 0);
  });
});

describe('oklchToHex', () => {
  it.each([
    '#0e5655',
    '#25dc89',
    '#f13800',
    '#0e0e2d',
    '#f7f7f9',
    '#808080',
    '#ffffff',
    '#000000',
  ] as const)('gives %s back from its OKLCH', (hex) => {
    expect(oklchToHex(hexToOklch(hex))).toBe(hex);
  });

  it('keeps lightness and hue but lowers chroma for a colour sRGB can’t show', () => {
    const wanted = { l: 0.3, c: 0.4, h: 100 };
    expect(inGamut(wanted)).toBe(false);
    const shown = hexToOklch(oklchToHex(wanted));
    expect(shown.l).toBeCloseTo(0.3, 2);
    expect(shown.h).toBeCloseTo(100, -1);
    expect(shown.c).toBeLessThan(0.4);
  });

  it('keeps lightness within black and white', () => {
    expect(oklchToHex({ l: -0.2, c: 0, h: 0 })).toBe('#000000');
    expect(oklchToHex({ l: 1.3, c: 0, h: 0 })).toBe('#ffffff');
  });
});

describe('maxChroma', () => {
  it('finds the most chroma sRGB can show at a lightness and hue', () => {
    const chroma = maxChroma(0.5, 260);
    expect(inGamut({ l: 0.5, c: chroma, h: 260 })).toBe(true);
    expect(inGamut({ l: 0.5, c: chroma + 0.005, h: 260 })).toBe(false);
  });

  it('allows a dark blue far more chroma than a dark yellow', () => {
    expect(maxChroma(0.2, 265)).toBeGreaterThan(3 * maxChroma(0.2, 100));
  });

  it('allows less towards black and white than in the middle', () => {
    expect(maxChroma(0.05, 265)).toBeLessThan(maxChroma(0.45, 265));
    expect(maxChroma(0.97, 265)).toBeLessThan(maxChroma(0.45, 265));
  });
});
