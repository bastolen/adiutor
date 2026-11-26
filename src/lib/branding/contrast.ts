/**
 * @file Contrast between two colours as WCAG 2 measures it: each colour's
 * relative luminance and the ratio between them, from 1 (the same) to 21
 * (black on white). The theme's rules (`rules.ts`) are written in these
 * ratios: 4.5:1 for text, 3:1 for borders of controls and focus rings.
 */
import { defined } from '@/lib/defined';

/** A colour as CSS writes it in six hex digits, e.g. `#0e5655`. */
export type HexColour = `#${string}`;

/**
 * A colour's relative luminance (WCAG 2).
 *
 * @param hex - The colour, as `#rrggbb`.
 * @returns Its luminance, from 0 (black) to 1 (white).
 */
export function luminance(hex: HexColour): number {
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
 * The contrast ratio between two colours (WCAG 2), whichever is lighter.
 *
 * @param a - One colour.
 * @param b - The other.
 * @returns The ratio, from 1 to 21.
 */
export function contrast(a: HexColour, b: HexColour): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (
    (defined(light, 'the lighter luminance') + 0.05) /
    (defined(dark, 'the darker luminance') + 0.05)
  );
}
