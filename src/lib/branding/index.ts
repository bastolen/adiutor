/**
 * @file Branding: the theme's colours as data and the rules every palette
 * keeps (readable text, visible borders and focus rings, elevation in dark
 * mode). This is the module's public API; the code lives in the files next
 * to it, and nothing outside this folder imports them directly.
 *
 * Everything here is free of zod and of server code, so services, pages,
 * emails and client components can all import it.
 */
export { contrast, type HexColour, luminance } from './contrast';
export {
  type BrokenRule,
  brokenRules,
  type ColourRef,
  colourIn,
  PALETTE_RULES,
  type PaletteRule,
  ruleHolds,
  SURFACES,
} from './rules';
export {
  type Palette,
  THEME_MODES,
  THEME_PALETTE,
  THEME_TOKENS,
  type ThemeColours,
  type ThemeMode,
  type ThemeToken,
} from './theme-colours';
