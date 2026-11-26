/**
 * @file Turns a worked-out palette into CSS. For the page (`paletteCss`):
 * one `:root:root` rule that sets every token differing from the theme with
 * `light-dark()`, like `theme.css` does, so it follows the colour scheme.
 * The doubled `:root` outranks `theme.css` wherever the two end up in the
 * page. For a preview of one mode (`paletteVariables`): the tokens as inline
 * custom properties.
 *
 * Only colours this module wrote in hex go into CSS, and every value is
 * checked again before it does: nothing else could close the rule.
 */
import type { BrandPalette } from './palette';
import { THEME_MODES, THEME_PALETTE, THEME_TOKENS, type ThemeMode } from './theme-colours';

/** A colour as the CSS takes it: six hex digits, or eight with how see-through it is. */
const CSS_COLOUR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;

/** The theme's overlay, written the same way, to tell whether a palette changed it. */
const THEME_OVERLAY = { light: '#0e0e2d80', dark: '#03030cb8' } as const;

/**
 * Checks a value before it goes into CSS.
 *
 * @param value - A colour from a palette.
 * @returns The value.
 * @throws {Error} When it isn't a hex colour.
 */
function cssColour(value: string): string {
  if (!CSS_COLOUR.test(value)) {
    throw new Error('A palette colour must be written in hex');
  }
  return value;
}

/**
 * The CSS that gives the page a palette, setting only what differs from the
 * theme.
 *
 * @param brand - The palette worked out from the brand colours.
 * @returns A `:root:root { … }` rule, or an empty string when the palette is the theme's.
 */
export function paletteCss(brand: BrandPalette): string {
  const declarations = THEME_TOKENS.filter((token) =>
    THEME_MODES.some((mode) => brand.palette[mode][token] !== THEME_PALETTE[mode][token]),
  ).map(
    (token) =>
      `--${token}:light-dark(${cssColour(brand.palette.light[token])},${cssColour(brand.palette.dark[token])});`,
  );
  if (THEME_MODES.some((mode) => brand.overlay[mode] !== THEME_OVERLAY[mode])) {
    declarations.push(
      `--overlay:light-dark(${cssColour(brand.overlay.light)},${cssColour(brand.overlay.dark)});`,
    );
  }
  return declarations.length === 0 ? '' : `:root:root{${declarations.join('')}}`;
}

/**
 * The palette's tokens in one mode as custom properties, for an element
 * that previews that mode.
 *
 * @param brand - The palette.
 * @param mode - The mode to preview.
 * @returns E.g. `{ '--primary': '#0e5655', … }`.
 */
export function paletteVariables(
  brand: BrandPalette,
  mode: ThemeMode,
): Record<`--${string}`, string> {
  return Object.fromEntries([
    ...THEME_TOKENS.map((token) => [`--${token}`, cssColour(brand.palette[mode][token])]),
    ['--overlay', cssColour(brand.overlay[mode])],
  ]) as Record<`--${string}`, string>;
}
