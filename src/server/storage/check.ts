/**
 * @file Tries a storage before it's saved: writes a small file, reads it
 * back and deletes it, on one connection, so a mistake in its settings shows
 * when they're saved rather than at someone's first upload.
 */
import { randomUUID } from 'node:crypto';

import { StorageError } from './errors';
import { checkKey } from './keys';
import type { FileStorage } from './types';

/** What the test file holds. */
const CHECK_TEXT = 'Adiutor checks that it can keep files here. This file is deleted at once.\n';

/**
 * Writes, reads back and deletes a test file.
 *
 * @param storage - The storage to try.
 * @throws {StorageError} When any step fails, or the file reads back otherwise.
 */
export default async function checkStorage(storage: FileStorage): Promise<void> {
  const key = checkKey(randomUUID());
  await storage.session(async (shared) => {
    await shared.put(key, new TextEncoder().encode(CHECK_TEXT), 'text/plain');
    const file = await shared.get(key);
    const text = file ? await new Response(file.body).text() : null;
    await shared.delete(key);
    if (text !== CHECK_TEXT) {
      throw new StorageError('failed');
    }
  });
}
