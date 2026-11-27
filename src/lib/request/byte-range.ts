/**
 * @file The part of a file a browser asks for (`Range: bytes=…`), as video
 * players do to start playing and to seek: one range only, from a byte to a
 * byte, from a byte to the end, or the last few bytes. Several ranges, or
 * anything this doesn't read, ask for the whole file, as HTTP allows.
 */

/** The part of a file asked for, before the file's size is known. */
export type RangeRequest =
  | {
      /** The first byte asked for. */
      start: number;
      /** The last byte asked for, or `null` for the end of the file. */
      end: number | null;
    }
  | {
      /** How many bytes from the end of the file. */
      suffix: number;
    };

/** A part of a file, both ends included. */
export interface ByteRange {
  /** Its first byte. */
  start: number;
  /** Its last byte. */
  end: number;
}

/** One range of bytes: a first byte and maybe a last, or the last few bytes. */
const ONE_RANGE = /^bytes=(?:(\d{1,15})-(\d{1,15})?|-(\d{1,15}))$/;

/**
 * Reads the range a request asks for.
 *
 * @param header - The request's `Range` header.
 * @returns The range, or `null` for the whole file (no header, several
 *   ranges, or one this doesn't read).
 */
export function parseRange(header: string | null): RangeRequest | null {
  const match = header === null ? null : ONE_RANGE.exec(header.trim());
  if (!match) {
    return null;
  }
  const [, first, last, suffix] = match;
  if (suffix !== undefined) {
    const bytes = Number(suffix);
    return bytes > 0 ? { suffix: bytes } : null;
  }
  const start = Number(first);
  const end = last === undefined ? null : Number(last);
  return end !== null && end < start ? null : { start, end };
}

/**
 * The bytes a range covers in a file of a size.
 *
 * @param range - The range asked for.
 * @param total - The file's size in bytes.
 * @returns Its first and last byte, or `null` when the file has none of it
 *   (an answer of `416 Range Not Satisfiable`).
 */
export function resolveRange(range: RangeRequest, total: number): ByteRange | null {
  if (total === 0) {
    return null;
  }
  if ('suffix' in range) {
    return { start: Math.max(0, total - range.suffix), end: total - 1 };
  }
  if (range.start >= total) {
    return null;
  }
  return { start: range.start, end: Math.min(range.end ?? total - 1, total - 1) };
}

/**
 * The `Range` header that asks for a range, as a storage that reads ranges
 * itself takes it.
 *
 * @param range - The range.
 * @returns The header's value.
 */
export function rangeHeader(range: RangeRequest): string {
  if ('suffix' in range) {
    return `bytes=-${range.suffix}`;
  }
  return `bytes=${range.start}-${range.end ?? ''}`;
}
