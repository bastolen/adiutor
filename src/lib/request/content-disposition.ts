/**
 * @file The `Content-Disposition` header of a file Adiutor serves as a
 * download (an attachment): never shown in the page, saved under its name.
 * The name goes in twice (RFC 6266): as `filename*`, percent-encoded UTF-8,
 * which browsers read first, and as plain `filename`, in ASCII without
 * quotes or backslashes, for anything that doesn't.
 */

/**
 * The name as plain ASCII, for `filename`: accents taken off where they
 * can be, any other character outside printable ASCII dropped, and the
 * characters that could end or escape the quoted value made `_`.
 *
 * @param name - The file's name.
 * @returns The name in ASCII, `file.<extension>` when nothing is left before the extension.
 */
function asciiName(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\%;]/g, '_')
    .trim();
  const dot = ascii.lastIndexOf('.');
  if (dot <= 0 || ascii.slice(0, dot).trim() === '') {
    const extension = dot >= 0 ? ascii.slice(dot) : '';
    return `file${extension}`;
  }
  return ascii;
}

/**
 * A name percent-encoded for `filename*`, which RFC 5987 allows fewer
 * characters in than `encodeURIComponent` leaves.
 *
 * @param name - The file's name.
 * @returns The encoded name.
 */
function encodedName(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*!]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The header for a file served as a download.
 *
 * @param name - The file's name, as it's kept (cleaned).
 * @returns E.g. `attachment; filename="cafe.pdf"; filename*=UTF-8''caf%C3%A9.pdf`.
 */
export default function attachmentDisposition(name: string): string {
  return `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodedName(name)}`;
}
