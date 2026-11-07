/**
 * @file Colours, fonts and sizes for emails.
 *
 * Email clients don't support CSS variables or stylesheets well, so emails
 * use inline styles built from these plain values. They match the app's
 * light theme in `src/styles/theme.css`.
 */
import type { CSSProperties } from 'react';

/** Email colours (the app's light-mode palette). */
export const colors = {
  /** Page background around the card. */
  background: '#f7f7f9',
  /** The card. */
  surface: '#ffffff',
  /** Card border and dividers. */
  border: '#e4e4e9',
  /** Body text (brand ink). */
  foreground: '#0e0e2d',
  /** Secondary text (6.4:1 on white). */
  muted: '#55556d',
  /** Buttons and links (brand teal). */
  primary: '#0e5655',
  /** Text on buttons. */
  primaryForeground: '#ffffff',
} as const;

/** The device's own sans-serif font, as in the app. */
export const fontFamily =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * The device's own monospace font, for codes to type over (see `EmailCode`),
 * so similar characters stay easy to tell apart.
 */
export const monoFontFamily = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

/** Body text style. */
export const paragraph: CSSProperties = {
  margin: '0 0 16px',
  color: colors.foreground,
  fontSize: '15px',
  lineHeight: '24px',
};

/** Small, secondary text style. */
export const small: CSSProperties = {
  margin: '0',
  color: colors.muted,
  fontSize: '13px',
  lineHeight: '20px',
};
