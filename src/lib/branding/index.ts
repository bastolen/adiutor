/**
 * @file Branding: the theme's colours as data, the rules every palette keeps
 * (readable text, visible borders and focus rings, elevation in dark mode),
 * the palette worked out from the brand colours a staff Admin chose, with
 * its CSS, and the name people see Adiutor by. This is the module's public
 * API; the code lives in the files next to it, and nothing outside this
 * folder imports them directly.
 *
 * Everything here is free of zod and of server code, so services, pages,
 * emails and client components can all import it.
 */
export {
  hexToOklch,
  inGamut,
  isHexColour,
  maxChroma,
  type Oklch,
  oklchToHex,
  tidyHexColour,
  typedHexColour,
} from './colour-space';
export { contrast, type HexColour, luminance } from './contrast';
export { paletteCss, paletteVariables } from './css';
export { ADIUTOR_NAME, forTitleTemplate, isOwnName, poweredByShown, signInAppName } from './name';
export {
  ACCENT_TOKENS,
  type BrandColours,
  type BrandPalette,
  type BrandPanelColours,
  derivePalette,
  NO_BRAND_COLOURS,
  THEME_PANEL,
  TINTED_TOKENS,
} from './palette';
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
