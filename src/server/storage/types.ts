/**
 * @file What every storage driver offers (decision 0044): putting a file
 * under a key, reading it back as a stream, and deleting it. Keys come from
 * `keys.ts` only, never from a name someone typed.
 */
import type { StorageDriver } from '@/lib/storage';

/** A file read back from storage. */
export interface StoredFile {
  /** Its bytes, as they arrive; cancelling the stream ends the read. */
  body: ReadableStream<Uint8Array>;
  /** Its size in bytes, when the storage says. */
  size: number | null;
}

/**
 * A place files are kept. Every call has time limits of its own, and a
 * failure throws a `StorageError` that names only the kind of failure.
 */
export interface FileStorage {
  /** Which driver it is. */
  readonly driver: StorageDriver;
  /**
   * Stores a file, replacing one under the same key.
   *
   * @param key - Where (`attachmentKey`).
   * @param bytes - The file.
   * @param contentType - Its type, for storages that keep one.
   */
  put(key: string, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>;
  /**
   * Reads a file.
   *
   * @param key - Where.
   * @returns The file, or `null` when nothing is stored under the key.
   */
  get(key: string): Promise<StoredFile | null>;
  /**
   * Deletes a file; one that isn't there counts as deleted.
   *
   * @param key - Where.
   */
  delete(key: string): Promise<void>;
  /**
   * Runs several calls on one connection, for drivers that connect (a job
   * that deletes many files); the others just run them.
   *
   * @param work - The calls, given the storage to make them on.
   * @returns What the work returns.
   */
  session<T>(work: (storage: FileStorage) => Promise<T>): Promise<T>;
}
