/**
 * @file The images a staff Admin uploads for the brand (decision 0052): the
 * logo and an own browser tab icon. What kind of image a file is and how
 * large, read from its first bytes before anything decodes it, the shapes
 * and sizes each may have, and the sizes Adiutor stores them at. Free of zod
 * and server code, so the Appearance tab's forms check the same rules first.
 */
import { BRAND_ICON_MIN_SIDE, BRAND_IMAGE_MAX_SIDE, BRAND_LOGO_MIN_HEIGHT } from '../input-rules';

/** The images the brand has: the logo, and an own browser tab icon. */
export const BRAND_IMAGE_KINDS = ['logo', 'icon'] as const;

/** One of {@link BRAND_IMAGE_KINDS}. */
export type BrandImageKind = (typeof BRAND_IMAGE_KINDS)[number];

/** The kinds of image a logo or icon may be uploaded as. */
export type ImageType = 'png' | 'jpeg';

/** The media type of each {@link ImageType}. */
export const IMAGE_CONTENT_TYPES: Readonly<Record<ImageType, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
};

/** A width and a height, in pixels. */
export interface ImageSize {
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/** What an image's first bytes say it is. */
export interface ImageFacts extends ImageSize {
  /** Its kind. */
  type: ImageType;
}

/**
 * How much wider than high a logo may be, and how much higher than wide: a
 * wordmark fits the sidebar's room at its height, a stacked logo still shows.
 */
export const LOGO_RATIO = { widest: 8, tallest: 2 } as const;

/**
 * How far from square an image may be and still count as "about square":
 * the longer side at most this many times the shorter. A logo that is
 * becomes the browser tab icon itself; an own icon has to be.
 */
export const ABOUT_SQUARE_RATIO = 1.5;

/**
 * The box Adiutor draws each kind of image into when it's uploaded, never
 * enlarging it: the logo shows at most 32 pixels high (and emails ask for no
 * more), the icon at most 180 pixels square, so this keeps several times
 * that for any screen.
 */
export const STORED_BOX: Readonly<Record<BrandImageKind, ImageSize>> = {
  logo: { width: 1024, height: 256 },
  icon: { width: 512, height: 512 },
};

/** Why an image can't be a logo or an icon, by the message that says so (`errors.branding.*`). */
export type BrandImageProblem =
  'tooManyPixels' | 'logoTooSmall' | 'logoShape' | 'iconTooSmall' | 'iconShape';

/** The eight bytes every PNG file starts with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Reads a big-endian unsigned number from the bytes, if they're all there.
 *
 * @param bytes - The file.
 * @param at - Where the number starts.
 * @param length - How many bytes it has (2 or 4).
 * @returns The number, or `null` past the end.
 */
function readUint(bytes: Uint8Array, at: number, length: 2 | 4): number | null {
  if (at < 0 || at + length > bytes.length) {
    return null;
  }
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = value * 256 + (bytes[at + index] ?? 0);
  }
  return value;
}

/**
 * The size of a PNG, from its first chunk, which must be `IHDR`.
 *
 * @param bytes - The file, starting with the PNG signature.
 * @returns Its size, or `null` when the header isn't there.
 */
function pngSize(bytes: Uint8Array): ImageSize | null {
  const isHeader =
    readUint(bytes, 8, 4) === 13 &&
    String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR' &&
    bytes.length >= 24;
  if (!isHeader) {
    return null;
  }
  const width = readUint(bytes, 16, 4);
  const height = readUint(bytes, 20, 4);
  return width && height ? { width, height } : null;
}

/**
 * Whether a JPEG marker starts a frame (SOF0 to SOF15), the segment that
 * holds the image's size: every `C0` to `CF` except `C4` (Huffman tables),
 * `C8` (reserved) and `CC` (arithmetic coding).
 *
 * @param marker - The byte after `FF`.
 * @returns Whether it's a frame's start.
 */
function isFrameStart(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

/**
 * The size of a JPEG, from its first frame header, walking the segments
 * before it by their lengths. Stops at the image data (`SOS`) or the end.
 *
 * @param bytes - The file, starting with `FF D8`.
 * @returns Its size, or `null` when no frame header comes first.
 */
function jpegSize(bytes: Uint8Array): ImageSize | null {
  let at = 2;
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) {
      return null;
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      // Fill byte before a marker.
      at += 1;
    } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      // Markers without a length.
      at += 2;
    } else if (marker === 0xd9 || marker === 0xda) {
      // The end, or the image data, before any frame header.
      return null;
    } else {
      const length = readUint(bytes, at + 2, 2);
      if (length === null || length < 2) {
        return null;
      }
      if (isFrameStart(marker)) {
        // Length, precision (1 byte), height, width.
        const height = readUint(bytes, at + 5, 2);
        const width = readUint(bytes, at + 7, 2);
        return width && height ? { width, height } : null;
      }
      at += 2 + length;
    }
  }
  return null;
}

/**
 * What kind of image a file is and how large, from its first bytes, before
 * anything decodes it: a PNG by its signature and `IHDR` chunk, a JPEG by
 * its start marker and frame header. The size is the one the file claims;
 * whether the rest of it decodes is only known once it's drawn.
 *
 * @param bytes - The file.
 * @returns Its kind and size, or `null` for anything else, a file cut short
 *   or an image without a size.
 */
export function imageFacts(bytes: Uint8Array): ImageFacts | null {
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    const size = pngSize(bytes);
    return size ? { type: 'png', ...size } : null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const size = jpegSize(bytes);
    return size ? { type: 'jpeg', ...size } : null;
  }
  return null;
}

/**
 * Whether an image is about square: its longer side at most
 * {@link ABOUT_SQUARE_RATIO} times its shorter.
 *
 * @param size - The image's size.
 * @returns Whether it is.
 */
export function isAboutSquare(size: ImageSize): boolean {
  const { width, height } = size;
  return Math.max(width, height) <= Math.min(width, height) * ABOUT_SQUARE_RATIO;
}

/**
 * Why an image can't be uploaded as a logo or an icon, by its size alone.
 *
 * @param kind - What it would be.
 * @param size - Its size, from {@link imageFacts}.
 * @returns The problem, or `null` when its size and shape fit.
 */
export function brandImageProblem(kind: BrandImageKind, size: ImageSize): BrandImageProblem | null {
  const { width, height } = size;
  if (width > BRAND_IMAGE_MAX_SIDE || height > BRAND_IMAGE_MAX_SIDE) {
    return 'tooManyPixels';
  }
  if (kind === 'logo') {
    if (height < BRAND_LOGO_MIN_HEIGHT) {
      return 'logoTooSmall';
    }
    return width > height * LOGO_RATIO.widest || height > width * LOGO_RATIO.tallest
      ? 'logoShape'
      : null;
  }
  if (width < BRAND_ICON_MIN_SIDE || height < BRAND_ICON_MIN_SIDE) {
    return 'iconTooSmall';
  }
  return isAboutSquare(size) ? null : 'iconShape';
}

/**
 * The size an image takes in a box, keeping its shape: shrunk until it
 * fits, and grown to fill it only when asked (a stored image never grows;
 * a browser tab icon fills its square), in whole pixels (at least one).
 *
 * @param size - The image's size.
 * @param box - The room.
 * @param options - How to fit it.
 * @param options.grow - Whether a smaller image grows to the box.
 * @returns The size it's drawn at.
 */
export function fitInto(
  size: ImageSize,
  box: ImageSize,
  { grow = false }: { grow?: boolean } = {},
): ImageSize {
  const scale = Math.min(box.width / size.width, box.height / size.height);
  const used = grow ? scale : Math.min(1, scale);
  return {
    width: Math.max(1, Math.round(size.width * used)),
    height: Math.max(1, Math.round(size.height * used)),
  };
}
