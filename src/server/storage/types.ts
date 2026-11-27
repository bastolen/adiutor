/**
 * @file What every storage driver offers (decision 0044): putting a file
 * under a key, reading it back as a stream (whole, or a part of it, for a
 * video that's played), and deleting it. Keys come from
 * `keys.ts` only, never from a name someone typed.
 */
import type { RangeRequest } from '@/lib/request/byte-range';
import type { StorageDriver } from '@/lib/storage';

/** A file read back from storage. */
export interface StoredFile {
  /** Its bytes, as they arrive; cancelling the stream ends the read. */
  body: ReadableStream<Uint8Array>;
  /** Its size in bytes, when the storage says. */
  size: number | null;
}

/** A part of a file read back from storage, or the file's size when it has none of the part. */
export type StoredPart =
  | {
      /** The part's bytes, as they arrive; cancelling the stream ends the read. */
      body: ReadableStream<Uint8Array>;
      /** Its first byte in the file. */
      start: number;
      /** Its last byte in the file. */
      end: number;
      /** The file's whole size, in bytes. */
      total: number;
    }
  | {
      /** The file has none of the part asked for (it starts past the end). */
      unsatisfiable: true;
      /** The file's whole size, when the storage says. */
      total: number | null;
    };

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
   * Reads a part of a file, as a video that's played asks for one.
   *
   * @param key - Where.
   * @param range - The part (`parseRange`).
   * @returns The part, or `null` when nothing is stored under the key.
   */
  getPart(key: string, range: RangeRequest): Promise<StoredPart | null>;
  /**
   * Deletes a file; one that isn't there counts as deleted.
   *
   * @param key - Where.
   */
  delete(key: string): Promise<void>;
  /**
   * Marks the place as Adiutor's, so files can be kept there: a marker file
   * in a folder (local disk and SFTP), nothing for a bucket. Only ever on
   * purpose (the test before a storage is saved, or a staff Admin setting up
   * the one the environment chooses), never by storing a file: a folder
   * that isn't marked (a server started without its volume) refuses every
   * call instead of taking files for gone.
   */
  setUp(): Promise<void>;
  /**
   * Whether the place is marked as Adiutor's (a bucket always is).
   *
   * @returns Whether it is.
   */
  isSetUp(): Promise<boolean>;
  /**
   * Runs several calls on one connection, for drivers that connect (a job
   * that deletes many files); the others just run them.
   *
   * @param work - The calls, given the storage to make them on.
   * @returns What the work returns.
   */
  session<T>(work: (storage: FileStorage) => Promise<T>): Promise<T>;
  /**
   * Lets go of what the driver keeps between calls (SFTP's connection), once
   * the calls and reads still under way are done: for a driver that's
   * replaced (Settings changed), or one built for a single job (the check
   * before a storage is saved). Nothing for the others.
   */
  close(): void;
}
