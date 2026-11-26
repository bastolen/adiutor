/**
 * @file Tests for the WCAG 2 luminance and contrast ratio.
 */
import { describe, expect, it } from 'vitest';

import { contrast, luminance } from './contrast';

describe('luminance', () => {
  it('runs from 0 for black to 1 for white', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('weighs green the most and blue the least, as the eye does', () => {
    expect(luminance('#00ff00')).toBeGreaterThan(luminance('#ff0000'));
    expect(luminance('#ff0000')).toBeGreaterThan(luminance('#0000ff'));
  });
});

describe('contrast', () => {
  it('measures the ratio between two colours, whichever is lighter', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBe(1);
  });

  it('gives the theme’s teal on white the ratio WCAG tools show', () => {
    expect(contrast('#0e5655', '#ffffff')).toBeCloseTo(8.46, 1);
  });
});
