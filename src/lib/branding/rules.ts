/**
 * @file The rules every palette keeps, in light and dark mode: text readable
 * (WCAG AA, 4.5:1) on every surface it stands on and on the fills it's
 * written on, borders of controls and focus rings visible (3:1), highlighted
 * code readable on the background it stands on, and in dark mode raised
 * layers (dialogs, menus, selects, toasts) a step lighter than the surfaces
 * they open over, which is how elevation shows on a dark background.
 *
 * The theme's own colours keep them (`src/styles/theme.test.ts`), and so does
 * every palette worked out from brand colours.
 */
import { contrast, type HexColour, luminance } from './contrast';
import {
  type Palette,
  THEME_MODES,
  type ThemeColours,
  type ThemeMode,
  type ThemeToken,
} from './theme-colours';

/** A colour a rule measures: a token of the palette, or a fixed colour (like white text). */
export type ColourRef = ThemeToken | HexColour;

/** Both modes, for the rules that hold in each. */
const BOTH: readonly ThemeMode[] = THEME_MODES;

/**
 * One rule a palette keeps:
 * - `contrast`: `text` on `on` reaches `min` (4.5 for text, 3 for borders
 *   and rings);
 * - `subtle`: `text` and `on` differ by less than `max`, for a fill that
 *   barely shows and so needs an outline;
 * - `lighter`: `text` is lighter than `on`, for elevation in dark mode.
 */
export type PaletteRule = Readonly<
  | { kind: 'contrast'; text: ColourRef; on: ColourRef; min: number; modes: readonly ThemeMode[] }
  | { kind: 'subtle'; text: ColourRef; on: ColourRef; max: number; modes: readonly ThemeMode[] }
  | { kind: 'lighter'; text: ColourRef; on: ColourRef; modes: readonly ThemeMode[] }
>;

/**
 * Rules of one kind for every pair of `texts` on `surfaces`.
 *
 * @param texts - The colours that must show.
 * @param surfaces - What they stand on.
 * @param min - The contrast they need.
 * @returns A rule per pair, for both modes.
 */
function readableOn(
  texts: readonly ColourRef[],
  surfaces: readonly ColourRef[],
  min: number,
): PaletteRule[] {
  return texts.flatMap((text) =>
    surfaces.map((on) => ({ kind: 'contrast' as const, text, on, min, modes: BOTH })),
  );
}

/** The surfaces text stands on: the page, cards, subtle fills and raised layers. */
export const SURFACES = [
  'background',
  'surface',
  'muted',
  'raised',
] as const satisfies ThemeToken[];

/** Every rule a palette keeps. */
export const PALETTE_RULES: readonly PaletteRule[] = [
  // Text, links and errors on every surface; body text also on fills inside raised layers.
  ...readableOn(['foreground', 'muted-foreground', 'highlight', 'danger'], SURFACES, 4.5),
  ...readableOn(['foreground', 'muted-foreground'], ['raised-muted'], 4.5),
  // The text on buttons, at rest and hovered.
  ...readableOn(['primary-foreground'], ['primary', 'primary-hover'], 4.5),
  ...readableOn(['danger-foreground'], ['danger', 'danger-hover'], 4.5),
  // Borders of inputs and other controls.
  ...readableOn(['border-strong'], ['background', 'surface', 'raised'], 3),
  // Focus rings, also around the item the keyboard is on in a raised layer.
  ...readableOn(['ring'], ['background', 'surface', 'raised', 'raised-muted'], 3),
  // Highlighted code and its caption, on the background code stands on.
  ...readableOn(
    [
      'code-comment',
      'code-keyword',
      'code-string',
      'code-number',
      'code-title',
      'code-type',
      'code-attribute',
      'muted-foreground',
      'foreground',
    ],
    ['background'],
    4.5,
  ),
  // The fill of the item the keyboard is on in a raised layer barely differs from the layer,
  // which is why it has an outline in the ring colour.
  { kind: 'subtle', text: 'raised-muted', on: 'raised', max: 3, modes: BOTH },
  // Dark mode: raised layers a step lighter than the surfaces they open over, their fills lighter again.
  { kind: 'lighter', text: 'raised', on: 'surface', modes: ['dark'] },
  { kind: 'lighter', text: 'raised', on: 'muted', modes: ['dark'] },
  { kind: 'lighter', text: 'raised-muted', on: 'raised', modes: ['dark'] },
];

/**
 * Reads a colour a rule measures.
 *
 * @param colours - The palette's colours in one mode.
 * @param ref - A token or a fixed colour.
 * @returns The colour.
 */
export function colourIn(colours: ThemeColours, ref: ColourRef): HexColour {
  return ref.startsWith('#') ? (ref as HexColour) : colours[ref as ThemeToken];
}

/**
 * Whether one mode of a palette keeps a rule.
 *
 * @param rule - The rule.
 * @param colours - The palette's colours in that mode.
 * @returns `true` when it holds.
 */
export function ruleHolds(rule: PaletteRule, colours: ThemeColours): boolean {
  const text = colourIn(colours, rule.text);
  const on = colourIn(colours, rule.on);
  if (rule.kind === 'contrast') {
    return contrast(text, on) >= rule.min;
  }
  if (rule.kind === 'subtle') {
    return contrast(text, on) < rule.max;
  }
  return luminance(text) > luminance(on);
}

/** A rule a palette doesn't keep, and in which mode. */
export type BrokenRule = Readonly<{ rule: PaletteRule; mode: ThemeMode }>;

/**
 * The rules a palette breaks.
 *
 * @param palette - The palette, in both modes.
 * @param rules - The rules to check (all of them by default).
 * @returns Each broken rule with its mode; empty when the palette keeps them all.
 */
export function brokenRules(
  palette: Palette,
  rules: readonly PaletteRule[] = PALETTE_RULES,
): BrokenRule[] {
  return rules.flatMap((rule) =>
    rule.modes.filter((mode) => !ruleHolds(rule, palette[mode])).map((mode) => ({ rule, mode })),
  );
}
