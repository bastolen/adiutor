/**
 * @file The theme's colours as data: every mode-aware colour token of
 * `src/styles/theme.css`, with its value in light and in dark mode. The
 * stylesheet is what the browser uses; this copy is what code can read, to
 * check a palette against the theme's rules (`rules.ts`) and to work out a
 * palette from brand colours on top of it. `src/styles/theme.test.ts` keeps
 * the two the same.
 */
import type { HexColour } from './contrast';

/** The two colour schemes the theme has a value for. */
export const THEME_MODES = ['light', 'dark'] as const;

/** Light or dark mode. */
export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * The mode-aware colour tokens, as named in `theme.css` (`--surface` is
 * `surface`). The overlay behind dialogs isn't one: it's see-through, so no
 * contrast rule can be measured on it.
 */
export const THEME_TOKENS = [
  'background',
  'surface',
  'muted',
  'raised',
  'raised-muted',
  'border',
  'border-strong',
  'foreground',
  'muted-foreground',
  'primary',
  'primary-hover',
  'primary-foreground',
  'highlight',
  'ring',
  'danger',
  'danger-hover',
  'danger-foreground',
  'danger-soft',
  'success',
  'success-soft',
  'warning',
  'warning-soft',
  'code-comment',
  'code-keyword',
  'code-string',
  'code-number',
  'code-title',
  'code-type',
  'code-attribute',
] as const;

/** A mode-aware colour token, e.g. `surface`. */
export type ThemeToken = (typeof THEME_TOKENS)[number];

/** Every token's colour in one mode. */
export type ThemeColours = Readonly<Record<ThemeToken, HexColour>>;

/** Every token's colour in both modes. */
export type Palette = Readonly<Record<ThemeMode, ThemeColours>>;

/** The theme's own colours, as in `theme.css` (brand colours resolved, short hex written out). */
export const THEME_PALETTE: Palette = {
  light: {
    background: '#f7f7f9',
    surface: '#ffffff',
    muted: '#f1f1f4',
    raised: '#ffffff',
    'raised-muted': '#f1f1f4',
    border: '#e4e4e9',
    'border-strong': '#8c8ca3',
    foreground: '#0e0e2d',
    'muted-foreground': '#55556d',
    primary: '#0e5655',
    'primary-hover': '#0b4544',
    'primary-foreground': '#ffffff',
    highlight: '#0e5655',
    ring: '#0e5655',
    danger: '#b42a00',
    'danger-hover': '#932200',
    'danger-foreground': '#ffffff',
    'danger-soft': '#fdeee8',
    success: '#0b6b4c',
    'success-soft': '#e3f6ee',
    warning: '#8a5000',
    'warning-soft': '#fcf1dc',
    'code-comment': '#55556d',
    'code-keyword': '#7b2d8e',
    'code-string': '#0b6b4c',
    'code-number': '#8a5000',
    'code-title': '#1f4fb3',
    'code-type': '#0e5655',
    'code-attribute': '#b42a00',
  },
  dark: {
    background: '#0b0b22',
    surface: '#14143a',
    muted: '#1c1c47',
    raised: '#1d1d4b',
    'raised-muted': '#2b2b5e',
    border: '#2a2a58',
    'border-strong': '#70709f',
    foreground: '#f1f1f6',
    'muted-foreground': '#a3a3c2',
    primary: '#25dc89',
    'primary-hover': '#4ae39e',
    'primary-foreground': '#0e0e2d',
    highlight: '#25dc89',
    ring: '#25dc89',
    danger: '#ff7a50',
    'danger-hover': '#ff9473',
    'danger-foreground': '#0e0e2d',
    'danger-soft': '#3a1c22',
    success: '#4ae39e',
    'success-soft': '#0f3330',
    warning: '#ffc266',
    'warning-soft': '#3a2e18',
    'code-comment': '#a3a3c2',
    'code-keyword': '#d9a8f7',
    'code-string': '#4ae39e',
    'code-number': '#ffc266',
    'code-title': '#8fb8ff',
    'code-type': '#5fe0cf',
    'code-attribute': '#ff9473',
  },
};
