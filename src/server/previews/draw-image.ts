/**
 * @file Draws the preview of an image with sharp (libvips): the first frame
 * of a PNG, JPEG, GIF or WebP, turned the way its camera says, fitted inside
 * `PREVIEW_SIZE` and stored as WebP without its metadata (no location). The
 * bytes' signature is checked first, so libvips never sees any other format
 * (SVG, TIFF, HEIC and the rest), and the decoding has a pixel and a time
 * limit (`limits.ts`). A PDF's page, drawn by PDFium, is made a preview
 * here too (`drawBitmap`). sharp is loaded on first use, so loading this
 * file costs nothing.
 */
import type { Sharp } from 'sharp';

import { type AttachmentCheck, matchesAttachmentKind } from '@/lib/requests';

import { IMAGE_LIMITS, type ImageLimits, PREVIEW_QUALITY, PREVIEW_SIZE } from './limits';

/** The kinds of image a preview is drawn from, by their signatures. */
const IMAGE_CHECKS: readonly AttachmentCheck[] = ['png', 'jpeg', 'gif', 'webp'];

/** The formats libvips may find in them: the same four. */
const IMAGE_FORMATS: ReadonlySet<string> = new Set(['png', 'jpeg', 'gif', 'webp']);

/** sharp, once it's loaded. */
let loading: Promise<typeof import('sharp')> | null = null;

/**
 * Loads sharp once, with libvips' cache off: each image is drawn once, so a
 * cache would only hold on to memory.
 *
 * @returns The module.
 */
async function loadSharp(): Promise<typeof import('sharp')> {
  loading ??= import('sharp').then((module) => {
    module.default.cache(false);
    return module;
  });
  return loading;
}

/** Pixels drawn elsewhere (a PDF's page): four bytes a pixel, rows packed, the fourth unused. */
export interface Bitmap {
  /** Its width in pixels. */
  width: number;
  /** Its height in pixels. */
  height: number;
  /** Its pixels: red, green, blue and an unused byte each. */
  data: Uint8Array;
}

/** An image to draw: its bytes, and which kinds it may be. */
export interface ImageToDraw {
  /** The file. */
  bytes: Uint8Array;
  /** The kinds of image it may be, by signature; any of the four by default. */
  checks?: readonly AttachmentCheck[];
  /** What it may cost; {@link IMAGE_LIMITS} by default. */
  limits?: ImageLimits;
}

/**
 * Draws an image's preview.
 *
 * @param image - The image.
 * @param image.bytes - The file.
 * @param image.checks - The kinds of image it may be, by signature.
 * @param image.limits - What it may cost.
 * @returns The preview as WebP, or `null` when it isn't one of the allowed
 *   kinds, is broken, or is past a limit.
 * @throws {Error} When sharp itself can't be loaded (the server is missing it).
 */
export default async function drawImage({
  bytes,
  checks = IMAGE_CHECKS,
  limits = IMAGE_LIMITS,
}: ImageToDraw): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!checks.some((check) => matchesAttachmentKind(check, bytes))) {
    return null;
  }
  const { default: sharp } = await loadSharp();
  let image: Sharp;
  try {
    image = sharp(bytes, {
      limitInputPixels: limits.maxPixels,
      sequentialRead: true,
      failOn: 'error',
      pages: 1,
    });
    const { format } = await image.metadata();
    if (!IMAGE_FORMATS.has(format)) {
      return null;
    }
    const webp = await image
      .autoOrient()
      .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: PREVIEW_QUALITY })
      .timeout({ seconds: limits.seconds })
      .toBuffer();
    // A copy of its own, as a plain Uint8Array.
    return new Uint8Array(webp);
  } catch {
    // Broken, past a limit, or too slow: the file keeps its icon.
    return null;
  }
}

/**
 * Draws a preview from pixels drawn elsewhere (a PDF's page), opaque.
 *
 * @param bitmap - The pixels.
 * @returns The preview as WebP, or `null` when they don't make an image.
 * @throws {Error} When sharp itself can't be loaded.
 */
export async function drawBitmap(bitmap: Bitmap): Promise<Uint8Array<ArrayBuffer> | null> {
  const { default: sharp } = await loadSharp();
  try {
    const webp = await sharp(bitmap.data, {
      raw: { width: bitmap.width, height: bitmap.height, channels: 4 },
    })
      .removeAlpha()
      .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: PREVIEW_QUALITY })
      .timeout({ seconds: IMAGE_LIMITS.seconds })
      .toBuffer();
    return new Uint8Array(webp);
  } catch {
    return null;
  }
}
