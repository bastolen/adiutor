/**
 * @file Where a file is kept: a key made from its ID only, never from a name
 * someone typed, so no key can climb out of its folder or bucket. Every
 * driver uses the same keys as paths under its folder or bucket, so the
 * files can be copied from one storage to another as they are.
 */

/**
 * A key: a kind, the ID's last two characters (256 folders), and the ID, a
 * UUID as the database writes one (lowercase), which must end in them.
 */
const KEY =
  /^(attachments|previews|pages|checks)\/([0-9a-f]{2})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{10}\2$/;

/**
 * The kinds of file: an attachment, its preview, a PDF's large first page,
 * and the file a storage test writes and deletes.
 */
type KeyKind = 'attachments' | 'previews' | 'pages' | 'checks';

/**
 * Makes a key.
 *
 * @param kind - The kind of file.
 * @param id - Its ID.
 * @returns The key, e.g. `attachments/3f/0197…3f`.
 * @throws {Error} When the ID isn't a UUID.
 */
function keyOf(kind: KeyKind, id: string): string {
  const key = `${kind}/${id.slice(-2)}/${id}`;
  if (!KEY.test(key)) {
    throw new Error('Not an ID a file can be kept under.');
  }
  return key;
}

/**
 * Where an attachment is kept.
 *
 * @param id - The attachment's ID.
 * @returns Its key.
 */
export function attachmentKey(id: string): string {
  return keyOf('attachments', id);
}

/**
 * Where an attachment's preview is kept: a small WebP image drawn from the
 * file, for its tile.
 *
 * @param id - The attachment's ID.
 * @returns Its preview's key.
 */
export function previewKey(id: string): string {
  return keyOf('previews', id);
}

/**
 * Where a PDF's first page is kept, drawn large for the viewer.
 *
 * @param id - The attachment's ID.
 * @returns Its page's key.
 */
export function pageKey(id: string): string {
  return keyOf('pages', id);
}

/**
 * Where a storage test keeps its file, for as long as the test takes.
 *
 * @param id - A new UUID.
 * @returns Its key.
 */
export function checkKey(id: string): string {
  return keyOf('checks', id);
}

/**
 * Makes sure a driver is given a key this file made.
 *
 * @param key - The key.
 * @throws {Error} When it's anything else.
 */
export function assertStorageKey(key: string): void {
  if (!KEY.test(key)) {
    throw new Error('Not a storage key.');
  }
}
