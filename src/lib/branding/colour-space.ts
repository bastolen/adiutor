/**
 * @file Colours in OKLCH, the space palettes are worked out in: lightness
 * (0 black to 1 white), chroma (0 grey, more is more colourful) and hue (an
 * angle in degrees). Unlike HSL, the same lightness looks equally light in
 * every hue, so a token can keep the theme's lightness while taking a brand's
 * hue. Conversions follow Björn Ottosson's OKLab, from and to sRGB hex.
 *
 * @see https://bottosson.github.io/posts/oklab/
 */
import { defined } from '@/lib/defined';

import type { HexColour } from './contrast';

/** A colour in OKLCH: lightness 0–1, chroma 0 and up, hue in degrees (0 for a grey). */
export type Oklch = Readonly<{ l: number; c: number; h: number }>;

/** A colour in linear sRGB, each channel 0–1 when it can be shown. */
type LinearRgb = readonly [number, number, number];

/** Six hex digits after a `#`, in lower case: the only colour format branding stores or writes. */
const HEX_COLOUR = /^#[0-9a-f]{6}$/;

/**
 * Whether a value is a colour as branding stores it: `#` and six lower-case
 * hex digits.
 *
 * @param value - The value.
 * @returns `true` for e.g. `#0e5655`.
 */
export function isHexColour(value: unknown): value is HexColour {
  return typeof value === 'string' && HEX_COLOUR.test(value);
}

/**
 * Turns an sRGB channel (0–1) into linear light.
 *
 * @param channel - The channel.
 * @returns Its linear value.
 */
function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * Turns a linear channel back into sRGB (0–1).
 *
 * @param channel - The linear value.
 * @returns The channel.
 */
function fromLinear(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/**
 * Reads a hex colour as linear sRGB.
 *
 * @param hex - The colour, as `#rrggbb`.
 * @returns Its channels.
 */
function linearRgbOf(hex: HexColour): LinearRgb {
  const [r, g, b] = [1, 3, 5].map((start) =>
    toLinear(parseInt(hex.slice(start, start + 2), 16) / 255),
  );
  return [
    defined(r, 'the red channel'),
    defined(g, 'the green channel'),
    defined(b, 'the blue channel'),
  ];
}

/**
 * Converts a hex colour to OKLCH.
 *
 * @param hex - The colour, as `#rrggbb`.
 * @returns Its lightness, chroma and hue.
 */
export function hexToOklch(hex: HexColour): Oklch {
  const [r, g, b] = linearRgbOf(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bAxis);
  // A grey has no hue; 0 keeps it from being a rounding error's angle.
  const hue = chroma < 1e-4 ? 0 : ((((Math.atan2(bAxis, a) * 180) / Math.PI) % 360) + 360) % 360;
  return { l: lightness, c: chroma, h: hue };
}

/**
 * Converts an OKLCH colour to linear sRGB, which may lie outside 0–1 when
 * sRGB can't show it.
 *
 * @param colour - The colour.
 * @param colour.l - Its lightness.
 * @param colour.c - Its chroma.
 * @param colour.h - Its hue.
 * @returns Its channels.
 */
function linearRgbFromOklch({ l, c, h }: Oklch): LinearRgb {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const lCone = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCone = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCone = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone,
    -1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone,
    -0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone,
  ];
}

/**
 * Whether sRGB can show an OKLCH colour (with a hair of room for rounding).
 *
 * @param colour - The colour.
 * @returns `true` when every channel is within 0–1.
 */
export function inGamut(colour: Oklch): boolean {
  return linearRgbFromOklch(colour).every((channel) => channel >= -1e-6 && channel <= 1 + 1e-6);
}

/**
 * The most chroma sRGB can show at a lightness and hue, below `upTo`.
 * Hues differ a lot: a dark yellow can hardly be colourful, a dark blue can.
 *
 * @param l - The lightness.
 * @param h - The hue.
 * @param upTo - Where to start looking (more than any sRGB colour has by default).
 * @returns The chroma.
 */
export function maxChroma(l: number, h: number, upTo = 0.4): number {
  if (inGamut({ l, c: upTo, h })) {
    return upTo;
  }
  // Halve the range 24 times: far finer than a hex digit.
  let [low, high] = [0, upTo];
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (inGamut({ l, c: middle, h })) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * Converts an OKLCH colour to hex. A colour sRGB can't show keeps its
 * lightness and hue and loses chroma until it can, which is how a brand's
 * hue still shows at a lightness where it can't be as colourful.
 *
 * @param colour - The colour; lightness is kept within 0–1.
 * @returns The colour, as `#rrggbb`.
 */
export function oklchToHex(colour: Oklch): HexColour {
  const l = Math.min(1, Math.max(0, colour.l));
  const c = Math.max(0, colour.c);
  const shown: Oklch = { l, c: maxChroma(l, colour.h, c), h: colour.h };
  const digits = linearRgbFromOklch(shown)
    .map((channel) => Math.round(Math.min(1, Math.max(0, fromLinear(channel))) * 255))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('');
  return `#${digits}`;
}
