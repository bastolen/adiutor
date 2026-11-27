/**
 * @file The limits on drawing a preview (decision 0057): the size of what's
 * drawn, and what a file may cost to draw. Files are untrusted, so every
 * drawing has a pixel and a time limit, and a file past one keeps its icon.
 */

/** A preview fits inside a square of this many pixels, never enlarged. */
export const PREVIEW_SIZE = 480;

/** The WebP quality previews are drawn at: small, and sharp enough for a tile. */
export const PREVIEW_QUALITY = 75;

/** The type a preview is stored and served as. */
export const PREVIEW_CONTENT_TYPE = 'image/webp';

/** What an image may cost to draw. */
export interface ImageLimits {
  /** The most pixels it may have (width × height), checked before it's decoded. */
  maxPixels: number;
  /** The longest drawing it may take, in seconds. */
  seconds: number;
}

/**
 * An attached image: up to 50 megapixels (any phone's photo), drawn within
 * 5 seconds.
 */
export const IMAGE_LIMITS: ImageLimits = { maxPixels: 50_000_000, seconds: 5 };

/**
 * How many previews one server draws at once. Decoding a large image takes
 * memory and a processor's time; an upload that finds both slots taken
 * leaves its preview for the previews job.
 */
export const DRAWINGS_AT_ONCE = 2;
