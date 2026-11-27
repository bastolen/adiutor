/**
 * @file The limits on drawing a preview (decision 0057): the size of what's
 * drawn, and what a file may cost to draw. Files are untrusted, so every
 * drawing has a pixel and a time limit, and a file past one keeps its icon.
 */

/** A preview fits inside a square of this many pixels, never enlarged. */
export const PREVIEW_SIZE = 480;

/** The WebP quality previews are drawn at: small, and sharp enough for a tile. */
export const PREVIEW_QUALITY = 75;

/**
 * A PDF's first page is drawn large too, for the viewer, inside a square of
 * this many pixels: an A4 page's text stays readable.
 */
export const PAGE_SIZE = 1600;

/** The WebP quality a PDF's large page is drawn at: text stays crisp. */
export const PAGE_QUALITY = 80;

/** The type a preview is stored and served as. */
export const PREVIEW_CONTENT_TYPE = 'image/webp';

/** What an image may cost to draw. */
export interface ImageLimits {
  /** The most pixels it may have (width × height), checked before it's decoded. */
  maxPixels: number;
  /**
   * The most pixels a progressive JPEG may have: it's decoded whole, about
   * 6 bytes a pixel, where any other image is decoded a little at a time.
   */
  maxProgressivePixels: number;
  /** The longest drawing it may take, in seconds. */
  seconds: number;
}

/**
 * An attached image: up to 50 megapixels (any phone's photo), or 16 for a
 * progressive JPEG (about 100 MB while it's decoded), drawn within 5 seconds.
 */
export const IMAGE_LIMITS: ImageLimits = {
  maxPixels: 50_000_000,
  maxProgressivePixels: 16_000_000,
  seconds: 5,
};

/**
 * The most scans a progressive JPEG may have: each is decoded in full before
 * a time limit can stop it, and an encoder writes about ten. The same limit
 * as jpegtran's.
 */
export const MAX_JPEG_SCANS = 100;

/**
 * A frame of a video, drawn by the uploader's browser: up to 4 megapixels,
 * drawn again within 5 seconds.
 */
export const VIDEO_FRAME_LIMITS: ImageLimits = {
  maxPixels: 4_000_000,
  maxProgressivePixels: 4_000_000,
  seconds: 5,
};

/** What a PDF may cost to draw. */
export interface PdfLimits {
  /** The most memory PDFium may take, in pages of 64 KiB. */
  memoryPages: number;
  /** The longest loading and drawing its first page may take, in seconds. */
  seconds: number;
}

/**
 * A PDF: its first page, in PDFium with at most 256 MiB of memory, within 5
 * seconds; one at a time per server.
 */
export const PDF_LIMITS: PdfLimits = { memoryPages: 4096, seconds: 5 };

/** How long PDFium's worker waits for the next PDF before it closes, in seconds. */
export const PDF_WORKER_IDLE_SECONDS = 60;

/**
 * How many PDFs one worker draws before it's started afresh: PDFium's memory
 * only ever grows.
 */
export const PDFS_PER_WORKER = 50;

/**
 * An Office or OpenDocument file, a zip archive: at most 10,000 entries, and
 * a thumbnail of at most 2 MB packed and 4 MB unpacked.
 */
export const OFFICE_LIMITS = { maxEntries: 10_000, maxPacked: 2_000_000, maxUnpacked: 4_000_000 };

/**
 * How many previews one server draws at once. Decoding a large image takes
 * memory and a processor's time; an upload that finds both slots taken
 * leaves its preview for the previews job.
 */
export const DRAWINGS_AT_ONCE = 2;
