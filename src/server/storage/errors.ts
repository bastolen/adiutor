/**
 * @file The one error storage drivers throw, naming only the kind of
 * failure: never what the storage replied, nor an address, a path or a key,
 * so it can be logged and shown to staff Admins as it is.
 */

/**
 * The kinds of failure:
 * - `unreachable`: no connection to the storage;
 * - `refused`: it refused the keys or the password;
 * - `host_key`: an SFTP server's host key isn't the one expected;
 * - `not_found`: the bucket or the folder isn't there;
 * - `not_writable`: the folder can't be written to (or the disk is full);
 * - `not_set_up`: a folder without Adiutor's marker file, so its files
 *   can't be told apart from a folder that isn't mounted;
 * - `timed_out`: it took too long;
 * - `failed`: anything else.
 */
export const STORAGE_FAILURES = [
  'unreachable',
  'refused',
  'host_key',
  'not_found',
  'not_writable',
  'not_set_up',
  'timed_out',
  'failed',
] as const;

/** One of {@link STORAGE_FAILURES}. */
export type StorageFailure = (typeof STORAGE_FAILURES)[number];

/** A storage call that failed. */
export class StorageError extends Error {
  /** The kind of failure. */
  readonly failure: StorageFailure;

  /**
   * Makes the error.
   *
   * @param failure - The kind of failure.
   * @param options - What caused it, kept for the server's log.
   */
  constructor(failure: StorageFailure, options?: ErrorOptions) {
    super(`The file storage failed: ${failure}.`, options);
    this.name = 'StorageError';
    this.failure = failure;
  }
}

/**
 * The storage error for something a call threw: itself when it's already
 * one, a timeout when a time limit ended it, else the given kind.
 *
 * @param error - What was thrown.
 * @param otherwise - The kind for anything else.
 * @returns The storage error.
 */
export function storageErrorOf(error: unknown, otherwise: StorageFailure): StorageError {
  if (error instanceof StorageError) {
    return error;
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new StorageError('timed_out', { cause: error });
  }
  return new StorageError(otherwise, { cause: error });
}
