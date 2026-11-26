/**
 * @file Branding: the theme's colours as data, the rules every palette keeps
 * (readable text, visible borders and focus rings, elevation in dark mode),
 * the palette worked out from the brand colours a staff Admin chose, with
 * its CSS, the name people see Adiutor by, and the rules for the logo and
 * browser tab icon a staff Admin uploads. This is the module's public
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
export {
  BRAND_ICON_SIZES,
  brandIconPath,
  type BrandIconSize,
  type BrandIconSource,
  brandIconSize,
  brandIconSource,
  BRANDING_PATH,
  brandLogoPath,
} from './icon';
export {
  ABOUT_SQUARE_RATIO,
  BRAND_IMAGE_KINDS,
  type BrandImageKind,
  type BrandLogo,
  type BrandImageProblem,
  brandImageProblem,
  fitInto,
  IMAGE_CONTENT_TYPES,
  type ImageFacts,
  imageFacts,
  type ImageSize,
  type ImageType,
  isAboutSquare,
  LOGO_RATIO,
  STORED_BOX,
} from './images';
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
