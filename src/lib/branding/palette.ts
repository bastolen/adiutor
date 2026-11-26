/**
 * @file Works out the palette a page shows from the brand colours a staff
 * Admin chose (decision 0047): an accent, optionally a different accent for
 * dark mode, and a tint for the greys. Nothing chosen is the theme itself.
 *
 * - **The tint** rebuilds every grey in both modes (backgrounds, surfaces,
 *   borders, text, and the dark text on light buttons): each keeps the
 *   theme's lightness and chroma and takes the tint's hue. A grey tint
 *   gives plain greys; the most colourful tints are as colourful as the
 *   theme's navy, never more.
 * - **The accent** is the main actions, links, highlights and focus rings.
 *   It keeps its hue and chroma; its lightness moves only as far as the
 *   rules need: darker in light mode, lighter in dark mode. The text on it
 *   is white or the darkest grey, whichever reads better.
 *
 * Errors, statuses and highlighted code keep the theme's colours. Every
 * result keeps the rules in `rules.ts`, which the tests check for every hue.
 */
import { hexToOklch, isHexColour, maxChroma, type Oklch, oklchToHex } from './colour-space';
import { contrast, type HexColour } from './contrast';
import { brokenRules, colourIn, PALETTE_RULES, type PaletteRule, ruleHolds } from './rules';
import {
  type Palette,
  THEME_MODES,
  THEME_PALETTE,
  type ThemeColours,
  type ThemeMode,
  type ThemeToken,
} from './theme-colours';

/** The brand colours a staff Admin can choose; `null` is the theme's own. */
export type BrandColours = Readonly<{
  /** Main actions, links and focus rings, in both modes unless `accentDark` is chosen. */
  accent: HexColour | null;
  /** The accent in dark mode; only with an `accent`. */
  accentDark: HexColour | null;
  /** The colour whose hue the greys take. */
  tint: HexColour | null;
}>;

/** No brand colours: the theme as it is. */
export const NO_BRAND_COLOURS: BrandColours = { accent: null, accentDark: null, tint: null };

/** A palette worked out from brand colours, and what had to give way for the rules. */
export type BrandPalette = Readonly<{
  /** Every token's colour in both modes. */
  palette: Palette;
  /** The dim behind dialogs, in each mode, as `#rrggbbaa`. */
  overlay: Readonly<Record<ThemeMode, string>>;
  /** The decorative brand panel of the signed-out pages, the same in both modes. */
  panel: BrandPanelColours;
  /** Whether the accent had to change lightness to keep the rules, per mode. */
  adjusted: Readonly<Record<ThemeMode, boolean>>;
}>;

/** The colours of the signed-out pages' brand panel (`--brand-panel*` in `theme.css`). */
export type BrandPanelColours = Readonly<{
  /** Its background, the darkest grey (white text stands on it). */
  background: HexColour;
  /** The bright glow in one corner: the dark mode's accent. */
  glow: HexColour;
  /** The deep glow in the other: the light mode's accent. */
  glowDeep: HexColour;
}>;

/** The theme's brand panel: ink, with glows in the brand's green and teal. */
export const THEME_PANEL: BrandPanelColours = {
  background: '#0e0e2d',
  glow: '#25dc89',
  glowDeep: '#0e5655',
};

/** The tokens the tint rebuilds: the greys, and the dark text on light fills. */
export const TINTED_TOKENS = [
  'background',
  'surface',
  'muted',
  'raised',
  'raised-muted',
  'border',
  'border-strong',
  'foreground',
  'muted-foreground',
  'code-comment',
  'primary-foreground',
  'danger-foreground',
] as const satisfies readonly ThemeToken[];

/** The tokens the accent sets. */
export const ACCENT_TOKENS = [
  'primary',
  'primary-hover',
  'primary-foreground',
  'highlight',
  'ring',
] as const satisfies readonly ThemeToken[];

/** The rules the accent and the text on it keep: links, focus rings and buttons. */
const ACCENT_RULES = PALETTE_RULES.filter((rule) =>
  ['highlight', 'ring', 'primary-foreground'].includes(rule.text),
);

/** The theme's overlay colours and how see-through they are (`rgb(14 14 45 / 50%)`, `rgb(3 3 12 / 72%)`). */
const THEME_OVERLAY: Readonly<Record<ThemeMode, { colour: HexColour; alpha: string }>> = {
  light: { colour: '#0e0e2d', alpha: '80' },
  dark: { colour: '#03030c', alpha: 'b8' },
};

/**
 * The chroma at which a tint shows at full strength, the theme's navy ink's
 * (0.061) and anything more colourful alike. Below it the greys take less
 * colour, down to none for a grey.
 */
const FULL_TINT_CHROMA = 0.04;

/**
 * The share of the most chroma a grey's lightness and hue allow that a
 * tinted grey may take. The navy greys stay well within it; dark greys in
 * warm hues, which sRGB can hardly make colourful, would otherwise turn
 * into a deep brown or olive instead of a grey with a hint of the brand.
 */
const TINT_GAMUT_SHARE = 0.6;

/** How far one step moves a colour's lightness while it's nudged to keep a rule. */
const LIGHTNESS_STEP = 0.005;

/** How much darker (light mode) or lighter (dark mode) the accent is under the pointer, as in the theme. */
const HOVER_SHIFT: Readonly<Record<ThemeMode, number>> = { light: -0.057, dark: 0.03 };

/**
 * Gives a theme colour the tint's hue, keeping its lightness, scaling its
 * chroma by the tint's strength, and keeping it to a share of what that
 * lightness and hue allow.
 *
 * @param themeColour - The theme's colour.
 * @param tint - The tint.
 * @returns The tinted colour.
 */
function tinted(themeColour: HexColour, tint: HexColour): HexColour {
  const { c: tintChroma, h } = hexToOklch(tint);
  const { l, c } = hexToOklch(themeColour);
  const wanted = c * Math.min(1, tintChroma / FULL_TINT_CHROMA);
  return oklchToHex({ l, c: Math.min(wanted, TINT_GAMUT_SHARE * maxChroma(l, h)), h });
}

/**
 * The accent at another lightness, as colourful for that lightness as the
 * chosen colour is for its own: a vivid colour stays vivid when it's made
 * lighter or darker, a muted one stays muted.
 *
 * @param base - The chosen accent.
 * @param l - The lightness.
 * @returns The accent at that lightness.
 */
function accentAt(base: Oklch, l: number): HexColour {
  const room = maxChroma(base.l, base.h);
  const share = room > 0 ? Math.min(1, base.c / room) : 0;
  return oklchToHex({ l, c: share * maxChroma(Math.min(1, Math.max(0, l)), base.h), h: base.h });
}

/**
 * Moves a colour's lightness by one step.
 *
 * @param hex - The colour.
 * @param direction - `-1` darker, `1` lighter.
 * @returns The colour a step darker or lighter.
 */
function nudged(hex: HexColour, direction: -1 | 1): HexColour {
  const { l, c, h } = hexToOklch(hex);
  return oklchToHex({ l: l + direction * LIGHTNESS_STEP, c, h });
}

/**
 * The direction that moves a rule's colour towards keeping it: away from
 * what it stands on for contrast, towards it for a subtle fill, lighter for
 * elevation.
 *
 * @param rule - The broken rule.
 * @param colours - The mode's colours.
 * @returns `1` to make the rule's colour lighter, `-1` darker.
 */
function directionFor(rule: PaletteRule, colours: ThemeColours): -1 | 1 {
  if (rule.kind === 'lighter') {
    return 1;
  }
  const textIsLighter =
    hexToOklch(colourIn(colours, rule.text)).l >= hexToOklch(colourIn(colours, rule.on)).l;
  return textIsLighter === (rule.kind === 'contrast') ? 1 : -1;
}

/**
 * Nudges the colours that a step of the palette set until the mode keeps
 * every rule about them: each rule's colour moves a step at a time (away
 * from what it stands on, or lighter for elevation). What they stand on
 * never moves, so a grey never gives way for a colour it didn't set.
 *
 * @param start - The mode's colours.
 * @param mode - The mode.
 * @param movable - The tokens this step set.
 * @returns The colours, keeping those rules.
 */
function keepRules(
  start: ThemeColours,
  mode: ThemeMode,
  movable: readonly ThemeToken[],
): ThemeColours {
  const colours: Record<ThemeToken, HexColour> = { ...start };
  // A step of 0.005 reaches black or white within 200.
  for (let pass = 0; pass < 200; pass += 1) {
    const broken = brokenRules({ ...THEME_PALETTE, [mode]: colours }).filter(
      ({ rule, mode: brokenMode }) =>
        brokenMode === mode && (movable as readonly string[]).includes(rule.text),
    );
    if (broken.length === 0) {
      break;
    }
    broken.forEach(({ rule }) => {
      const token = rule.text as ThemeToken;
      colours[token] = nudged(colours[token], directionFor(rule, colours));
    });
  }
  return colours;
}

/**
 * Rebuilds the greys of one mode in the tint's hue, keeping the rules.
 *
 * @param colours - The mode's colours so far.
 * @param mode - The mode.
 * @param tint - The tint.
 * @returns The mode's colours with tinted greys.
 */
function tintMode(colours: ThemeColours, mode: ThemeMode, tint: HexColour): ThemeColours {
  const result: Record<ThemeToken, HexColour> = { ...colours };
  TINTED_TOKENS.forEach((token) => {
    result[token] = tinted(THEME_PALETTE[mode][token], tint);
  });
  return keepRules(result, mode, TINTED_TOKENS);
}

/**
 * The darkest grey of a mode: its text in light mode, or the dark text that
 * dark mode puts on light fills (`danger-foreground`, which the tint sets
 * and the accent never does).
 *
 * @param colours - The mode's colours.
 * @param mode - The mode.
 * @returns The darkest grey.
 */
function darkestOf(colours: ThemeColours, mode: ThemeMode): HexColour {
  return mode === 'light' ? colours.foreground : colours['danger-foreground'];
}

/**
 * Sets the accent tokens of one mode from the accent's hue and chroma at a
 * lightness, with the text on it that reads better (white or the darkest
 * grey).
 *
 * @param colours - The mode's colours.
 * @param mode - The mode.
 * @param base - The accent.
 * @param l - The lightness to try.
 * @returns The mode's colours with that accent and its hover colour.
 */
function withAccent(colours: ThemeColours, mode: ThemeMode, base: Oklch, l: number): ThemeColours {
  const accent = accentAt(base, l);
  const hover = accentAt(base, l + HOVER_SHIFT[mode]);
  /**
   * How well a text colour reads on the accent, at rest and hovered.
   *
   * @param text - The text colour.
   * @returns The lower of its two contrasts.
   */
  const readability = (text: HexColour) => Math.min(contrast(text, accent), contrast(text, hover));
  const darkest = darkestOf(colours, mode);
  const foreground = readability('#ffffff') >= readability(darkest) ? '#ffffff' : darkest;
  return {
    ...colours,
    primary: accent,
    'primary-hover': hover,
    'primary-foreground': foreground,
    highlight: accent,
    ring: accent,
  };
}

/** The most steps the accent's lightness can take: from where it starts to black or white. */
const MAX_ACCENT_STEPS = Math.ceil(1 / LIGHTNESS_STEP);

/**
 * Sets the accent of one mode: the chosen colour, made darker (light mode)
 * or lighter (dark mode) only as far as the rules need. Black and white
 * keep them all, so it ends there at the latest, within
 * {@link MAX_ACCENT_STEPS}.
 *
 * @param colours - The mode's colours, greys already set.
 * @param mode - The mode.
 * @param accent - The chosen accent for this mode.
 * @returns The mode's colours with the accent, and whether it had to move.
 */
function accentMode(
  colours: ThemeColours,
  mode: ThemeMode,
  accent: HexColour,
): { colours: ThemeColours; adjusted: boolean } {
  const base = hexToOklch(accent);
  const direction = mode === 'light' ? -1 : 1;
  for (let step = 0; step < MAX_ACCENT_STEPS; step += 1) {
    const l = base.l + direction * step * LIGHTNESS_STEP;
    const candidate = withAccent(colours, mode, base, l);
    const reachedEnd = direction < 0 ? l <= 0 : l >= 1;
    if (reachedEnd || ACCENT_RULES.every((rule) => ruleHolds(rule, candidate))) {
      return { colours: candidate, adjusted: step > 0 };
    }
  }
  return { colours: withAccent(colours, mode, base, direction < 0 ? 0 : 1), adjusted: true };
}

/**
 * A brand colour as the palette takes it: one in six hex digits, or `null`
 * (the theme's own) for anything else. Callers check their colours already;
 * this makes sure nothing else can reach the lightness search or the CSS.
 *
 * @param colour - The colour.
 * @returns The colour, or `null`.
 */
function checked(colour: HexColour | null): HexColour | null {
  return isHexColour(colour) ? colour : null;
}

/**
 * Works out the palette for a set of brand colours. A dark accent counts
 * only with an accent, and anything that isn't a colour in six hex digits
 * counts as the theme's own.
 *
 * @param chosen - The brand colours; `null` for the theme's own.
 * @returns The palette in both modes, the overlay and the brand panel, and
 *   whether the accent had to move.
 */
export function derivePalette(chosen: BrandColours): BrandPalette {
  const accentChosen = checked(chosen.accent);
  const brand: BrandColours = {
    accent: accentChosen,
    accentDark: accentChosen ? checked(chosen.accentDark) : null,
    tint: checked(chosen.tint),
  };
  const adjusted: Record<ThemeMode, boolean> = { light: false, dark: false };
  const modes = THEME_MODES.map((mode) => {
    let colours = THEME_PALETTE[mode];
    if (brand.tint) {
      colours = tintMode(colours, mode, brand.tint);
    }
    const accent = mode === 'dark' ? (brand.accentDark ?? brand.accent) : brand.accent;
    if (accent) {
      const result = accentMode(colours, mode, accent);
      colours = result.colours;
      adjusted[mode] = result.adjusted;
    } else if (brand.tint && !ACCENT_RULES.every((rule) => ruleHolds(rule, colours))) {
      // The theme's own accent on tinted greys: moved like a chosen one, should a grey need it.
      colours = accentMode(colours, mode, THEME_PALETTE[mode].primary).colours;
    }
    const { colour, alpha } = THEME_OVERLAY[mode];
    return {
      mode,
      colours,
      overlay: `${brand.tint ? tinted(colour, brand.tint) : colour}${alpha}`,
    };
  });
  /**
   * Gathers one thing from each mode's result.
   *
   * @param pick - What to take from a mode's result.
   * @returns It, by mode.
   */
  const byMode = <T>(pick: (entry: (typeof modes)[number]) => T) =>
    Object.fromEntries(modes.map((entry) => [entry.mode, pick(entry)])) as Record<ThemeMode, T>;
  const palette = byMode(({ colours }) => colours);
  return {
    palette,
    overlay: byMode(({ overlay }) => overlay),
    panel: {
      // The light mode's text, which white reads on as well as it reads on white.
      background: brand.tint ? palette.light.foreground : THEME_PANEL.background,
      glow: brand.accent ? palette.dark.primary : THEME_PANEL.glow,
      glowDeep: brand.accent ? palette.light.primary : THEME_PANEL.glowDeep,
    },
    adjusted,
  };
}
