/**
 * @file Colours, fonts and sizes for emails.
 *
 * Email clients don't support CSS variables or stylesheets well, so emails
 * use inline styles built from these plain values. The defaults match the app's
 * light theme in `src/styles/theme.css`; a brand's colours replace them
 * (decision 0047).
 */
import type { CSSProperties } from 'react';

import { type BrandPalette, type HexColour, isHexColour } from '@/lib/branding';

/** The colours an email is drawn with. */
export interface EmailColours {
  /** Page background around the card. */
  background: HexColour;
  /** The card. */
  surface: HexColour;
  /** Card border and dividers. */
  border: HexColour;
  /** Body text. */
  foreground: HexColour;
  /** Secondary text. */
  muted: HexColour;
  /** Buttons and links. */
  primary: HexColour;
  /** Text on buttons. */
  primaryForeground: HexColour;
}

/**
 * The colours of an email when no brand colours were chosen: the app's
 * light theme (`src/styles/theme.css`), which is what `derivePalette` gives
 * for `NO_BRAND_COLOURS`.
 */
export const DEFAULT_EMAIL_COLOURS: EmailColours = {
  background: '#f7f7f9',
  surface: '#ffffff',
  border: '#e4e4e9',
  foreground: '#0e0e2d',
  muted: '#55556d',
  primary: '#0e5655',
  primaryForeground: '#ffffff',
};

/**
 * The colours of an email in a brand's light palette (emails have no dark
 * mode; decision 0047). They go into inline styles, so each is checked to be
 * a hex colour once more, like the page's CSS (`paletteCss`); anything else
 * would be a bug, and the email keeps the theme's colour there instead.
 *
 * @param brand - The worked-out palette (`derivePalette`).
 * @returns The email's colours.
 */
export function emailColoursOf(brand: BrandPalette): EmailColours {
  const { light } = brand.palette;
  const picked: EmailColours = {
    background: light.background,
    surface: light.surface,
    border: light.border,
    foreground: light.foreground,
    muted: light['muted-foreground'],
    primary: light.primary,
    primaryForeground: light['primary-foreground'],
  };
  return Object.fromEntries(
    (Object.keys(picked) as (keyof EmailColours)[]).map((key) => [
      key,
      isHexColour(picked[key]) ? picked[key] : DEFAULT_EMAIL_COLOURS[key],
    ]),
  ) as unknown as EmailColours;
}

/**
 * The colours of an email: the brand's, or the theme's own without a brand.
 *
 * @param brand - The email's `brand` prop.
 * @returns The colours to pass to every block.
 */
export function emailColours(brand: { colours: EmailColours } | undefined): EmailColours {
  return brand?.colours ?? DEFAULT_EMAIL_COLOURS;
}

/**
 * The device's own sans-serif font. The app ships Inter, but many email
 * clients block or strip web fonts, so emails don't rely on it.
 */
export const fontFamily =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * The device's own monospace font, for codes to type over (see `EmailCode`),
 * so similar characters stay easy to tell apart.
 */
export const monoFontFamily = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

/**
 * Body text style.
 *
 * @param colours - The email's colours.
 * @returns The style.
 */
export function paragraph(colours: EmailColours): CSSProperties {
  return {
    margin: '0 0 16px',
    color: colours.foreground,
    fontSize: '15px',
    lineHeight: '24px',
  };
}

/**
 * Small, secondary text style.
 *
 * @param colours - The email's colours.
 * @returns The style.
 */
export function small(colours: EmailColours): CSSProperties {
  return {
    margin: '0',
    color: colours.muted,
    fontSize: '13px',
    lineHeight: '20px',
  };
}
