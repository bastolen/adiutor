/**
 * @file Reads the start of a text file for the viewer (decision 0058): at
 * most `TEXT_PREVIEW_BYTES`, asked for as a part of the file, decoded the way
 * the upload checked it (UTF-16 after its byte order mark, else UTF-8),
 * without a character cut in half at the end. The text is only ever shown
 * as text.
 */

/** How much of a text file the viewer shows: 200 KB, more than a page of logs to scroll. */
export const TEXT_PREVIEW_BYTES = 200 * 1024;

/** The start of a text file, as the viewer shows it. */
export interface TextStart {
  /** The text. */
  text: string;
  /** Whether the file goes on past it. */
  cut: boolean;
}

/**
 * Decodes the start of a text file: UTF-16 after its byte order mark, else
 * UTF-8 (its mark dropped too). A file that goes on past these bytes keeps
 * back a character cut in half at the end, rather than show it broken.
 *
 * @param bytes - The bytes read, from the file's start.
 * @param cut - Whether the file goes on past them.
 * @returns The text.
 */
export function decodeTextStart(bytes: Uint8Array, cut: boolean): string {
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
  }
  return new TextDecoder(encoding).decode(bytes, { stream: cut });
}

/**
 * Reads the start of a text file from its address: a part of it, never more
 * than `TEXT_PREVIEW_BYTES` even from a server that sends the whole file, and
 * only the file itself (no redirect, only `200` or `206`).
 *
 * @param href - The file's address.
 * @param size - Its size in bytes.
 * @param signal - Stops the read (the viewer moved on).
 * @returns Its start.
 * @throws {Error} When the file can't be read.
 */
export async function readTextStart(
  href: string,
  size: number,
  signal: AbortSignal,
): Promise<TextStart> {
  const response = await fetch(href, {
    headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` },
    // Never another page's text: a session that ended would be sent to sign in.
    redirect: 'error',
    signal,
  });
  if ((response.status !== 200 && response.status !== 206) || !response.body) {
    throw new Error('The file could not be read.');
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(Math.min(size, TEXT_PREVIEW_BYTES));
  let filled = 0;
  try {
    while (filled < bytes.length) {
      // eslint-disable-next-line no-await-in-loop -- a stream is read a piece at a time
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const piece = value.subarray(0, bytes.length - filled);
      bytes.set(piece, filled);
      filled += piece.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const cut = filled < size;
  return { text: decodeTextStart(bytes.subarray(0, filled), cut), cut };
}
