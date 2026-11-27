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
 * Decodes the start of a text file.
 *
 * @param bytes - The bytes read, from the file's start.
 * @param cut - Whether the file goes on past them.
 * @returns The text, without a character cut in half at the end.
 */
export function decodeTextStart(bytes: Uint8Array, cut: boolean): string {
  const littleEndian = bytes[0] === 0xff && bytes[1] === 0xfe;
  if (littleEndian || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    // Whole UTF-16 units only; a pair of surrogates cut in half ends as one replacement.
    const even = bytes.subarray(2, bytes.length - (bytes.length % 2));
    const text = new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be').decode(even);
    return cut ? text.replace(/�$/, '') : text;
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  // A character cut in half at the end decodes as a replacement character.
  return cut ? text.replace(/�+$/, '') : text;
}

/**
 * Reads the start of a text file from its address: a part of it, never more
 * than `TEXT_PREVIEW_BYTES` even from a server that sends the whole file.
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
    signal,
  });
  if (!response.ok || !response.body) {
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
