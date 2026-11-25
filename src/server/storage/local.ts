/**
 * @file The local disk driver: files in a folder on the server, at their key
 * under it. A marker file says the folder is Adiutor's: reading and deleting
 * refuse without it, so a server started without its volume (a jobs
 * container, say) can't take files for gone and mark them deleted. Only
 * storing a file writes the marker, the first time. One server only: several
 * would each see their own disk.
 */
import { randomUUID } from 'node:crypto';
import { type FileHandle, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';

import { StorageError } from './errors';
import { assertStorageKey } from './keys';
import type { FileStorage } from './types';

/** The marker file's name, in the folder itself. */
export const MARKER_FILE = '.adiutor-attachments';

/** What the marker file says, for someone who finds it. */
const MARKER_TEXT =
  'This folder holds the files attached in Adiutor. Keep this file with them: without it, Adiutor refuses to read or delete files here.\n';

/**
 * Whether an error is Node's for a missing file.
 *
 * @param error - What was thrown.
 * @returns Whether it's `ENOENT`.
 */
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

/**
 * The storage error for a file system error.
 *
 * @param error - What was thrown.
 * @returns The storage error.
 */
function diskError(error: unknown): StorageError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new StorageError('not_found', { cause: error });
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'ENOSPC') {
    return new StorageError('not_writable', { cause: error });
  }
  return new StorageError('failed', { cause: error });
}

/**
 * A storage in a folder on the server's disk.
 *
 * @param dir - The folder, an absolute path; it must exist.
 * @returns The storage.
 */
export default function diskStorage(dir: string): FileStorage {
  const marker = join(dir, MARKER_FILE);

  /**
   * The file's path, for a key this module made.
   *
   * @param key - The key.
   * @returns Its path under the folder.
   */
  const pathOf = (key: string) => {
    assertStorageKey(key);
    return join(dir, key);
  };

  /** Refuses to go on in a folder without the marker. */
  const assertMarked = async () => {
    try {
      await stat(marker);
    } catch (error) {
      throw isMissing(error) ? new StorageError('not_set_up') : diskError(error);
    }
  };

  /** Writes the marker unless it's there, in a folder that must exist. */
  const mark = async () => {
    try {
      await writeFile(marker, MARKER_TEXT, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw diskError(error);
      }
    }
  };

  const storage: FileStorage = {
    driver: 'local',

    /**
     * Stores a file, writing the marker the first time.
     *
     * @param key - Where.
     * @param bytes - The file.
     */
    async put(key, bytes) {
      const path = pathOf(key);
      await mark();
      // Written beside its place first, so nobody ever reads half a file.
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temporary, bytes, { flag: 'wx' });
        await rename(temporary, path);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw diskError(error);
      }
    },

    /**
     * Reads a file, in a folder with the marker.
     *
     * @param key - Where.
     * @returns The file and its size, or `null` when it isn't there.
     */
    async get(key) {
      const path = pathOf(key);
      await assertMarked();
      // Opened before it's streamed, so a missing file is `null` rather than a broken stream,
      // and streamed from that handle, so a file deleted meanwhile is still read whole.
      let handle: FileHandle;
      try {
        handle = await open(path, 'r');
      } catch (error) {
        if (isMissing(error)) {
          return null;
        }
        throw diskError(error);
      }
      try {
        const { size } = await handle.stat();
        // The stream closes the handle when it ends or is cancelled.
        const body = Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;
        return { body, size };
      } catch (error) {
        await handle.close().catch(() => {});
        throw diskError(error);
      }
    },

    /**
     * Deletes a file, in a folder with the marker; one that isn't there counts as deleted.
     *
     * @param key - Where.
     */
    async delete(key) {
      const path = pathOf(key);
      await assertMarked();
      try {
        await rm(path, { force: true });
      } catch (error) {
        throw diskError(error);
      }
    },

    /**
     * Runs the calls; a folder needs no connection.
     *
     * @param work - The calls.
     * @returns What they return.
     */
    session: (work) => work(storage),
  };
  return storage;
}
