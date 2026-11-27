/**
 * @file The SFTP driver: files in a folder on another server, at their key
 * under it, over SSH (`ssh2`). Every connection checks the server's host key
 * against the fingerprint it was given, and a connection to any other key
 * is refused. Like the local disk, the folder has a marker file: storing,
 * reading and deleting refuse without it, and only setting the storage up
 * writes it (`setUp`). A single
 * call connects, works and disconnects; a file being read keeps its
 * connection until the read ends; a session (a job's run) shares one.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { Readable } from 'node:stream';

import { Client, type SFTPWrapper } from 'ssh2';

import { type RangeRequest, resolveRange } from '@/lib/request/byte-range';
import type { SftpStorageConfig } from '@/lib/storage';

import { StorageError } from './errors';
import withIdleLimit from './idle-limit';
import { assertStorageKey } from './keys';
import { MARKER_FILE } from './local';
import type { FileStorage } from './types';

/** The time limits, in milliseconds. */
export interface SftpTimeouts {
  /** For connecting and the SSH handshake. */
  connect: number;
  /** For each call but an upload (a look, a folder, a delete). */
  call: number;
  /** For an upload, which sends the whole file. */
  put: number;
  /** For each next piece of a file that's being read. */
  idle: number;
}

/** The time limits a server uses. */
const TIMEOUTS: SftpTimeouts = { connect: 10_000, call: 15_000, put: 120_000, idle: 30_000 };

/** SFTP's status codes that matter here (`SSH_FX_*`). */
const NO_SUCH_FILE = 2;
const PERMISSION_DENIED = 3;

/** What the marker file says, for someone who finds it. */
const MARKER_TEXT =
  'This folder holds the files attached in Adiutor. Keep this file with them: without it, Adiutor refuses to keep, read or delete files here.\n';

/**
 * A host key's fingerprint as OpenSSH prints it (`ssh-keygen -lf`): SHA-256,
 * in base64 without padding.
 *
 * @param key - The host key, as the server sent it.
 * @returns E.g. `SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s`.
 */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/**
 * Whether two fingerprints are the same, in a time that doesn't tell how
 * much of them matched.
 *
 * @param seen - The server's.
 * @param expected - The one configured.
 * @returns Whether they match.
 */
function sameFingerprint(seen: string, expected: string): boolean {
  const a = Buffer.from(seen);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Whether an SFTP error has a status code.
 *
 * @param error - What a call failed with.
 * @param code - The code.
 * @returns Whether it's that code.
 */
function hasStatus(error: unknown, code: number): boolean {
  return (error as { code?: unknown } | undefined)?.code === code;
}

/**
 * The storage error for a connection that failed.
 *
 * @param error - What it failed with.
 * @param hostKeyRefused - Whether this driver refused the server's host key.
 * @returns The storage error.
 */
function connectionError(error: unknown, hostKeyRefused: boolean): StorageError {
  if (hostKeyRefused) {
    return new StorageError('host_key', { cause: error });
  }
  const { level, code } = (error ?? {}) as { level?: string; code?: string };
  if (level === 'client-authentication') {
    return new StorageError('refused', { cause: error });
  }
  if (level === 'client-timeout' || code === 'ETIMEDOUT') {
    return new StorageError('timed_out', { cause: error });
  }
  if (level === 'client-socket') {
    return new StorageError('unreachable', { cause: error });
  }
  return new StorageError('failed', { cause: error });
}

/**
 * The storage error for an SFTP call that failed.
 *
 * @param error - What it failed with.
 * @returns The storage error.
 */
function callError(error: unknown): StorageError {
  if (error instanceof StorageError) {
    return error;
  }
  if (hasStatus(error, NO_SUCH_FILE)) {
    return new StorageError('not_found', { cause: error });
  }
  if (hasStatus(error, PERMISSION_DENIED)) {
    return new StorageError('not_writable', { cause: error });
  }
  return new StorageError('failed', { cause: error });
}

/** An open SFTP connection. */
interface Connection {
  /** Its SFTP channel. */
  sftp: SFTPWrapper;
  /** Closes it. */
  end: () => void;
}

/**
 * Connects to the server and opens SFTP on it, checking its host key.
 *
 * @param config - The server's settings.
 * @param timeouts - The time limits.
 * @returns The connection.
 */
function connect(config: SftpStorageConfig, timeouts: SftpTimeouts): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let hostKeyRefused = false;
    let open = false;
    // Kept for the connection's life: an `error` event without a listener would crash the server.
    client.on('error', (error) => {
      if (!open) {
        reject(connectionError(error, hostKeyRefused));
      }
    });
    client.once('ready', () => {
      // Opening the SFTP channel has a time limit of its own: a server can stall after the handshake.
      let late = false;
      const timer = setTimeout(() => {
        late = true;
        client.end();
        reject(new StorageError('timed_out'));
      }, timeouts.call);
      client.sftp((error, sftp) => {
        clearTimeout(timer);
        if (late) {
          return;
        }
        if (error) {
          client.end();
          reject(new StorageError('failed', { cause: error }));
          return;
        }
        open = true;
        resolve({
          sftp,
          /** Closes the connection. */
          end: () => {
            client.end();
          },
        });
      });
    });
    client.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
      readyTimeout: timeouts.connect,
      /**
       * Accepts only the configured host key.
       *
       * @param key - The server's host key.
       * @returns Whether to go on.
       */
      hostVerifier: (key: Buffer) => {
        const matches = sameFingerprint(hostKeyFingerprint(key), config.hostKey);
        hostKeyRefused = !matches;
        return matches;
      },
    });
  });
}

/**
 * Runs an SFTP call with a time limit; past it, the connection is closed.
 *
 * @param connection - The connection.
 * @param ms - The time limit.
 * @param run - Starts the call, given its callback.
 * @returns What the call gives.
 */
function call<T>(
  connection: Connection,
  ms: number,
  run: (done: (error: Error | null | undefined, value?: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new StorageError('timed_out'));
      connection.end();
    }, ms);
    run((error, value) => {
      clearTimeout(timer);
      if (error) {
        reject(callError(error));
      } else {
        resolve(value as T);
      }
    });
  });
}

/**
 * Whether a path exists on the server.
 *
 * @param connection - The connection.
 * @param path - The path.
 * @param ms - The time limit.
 * @returns Its size when it's there, else `null`.
 */
async function sizeOf(connection: Connection, path: string, ms: number): Promise<number | null> {
  try {
    const stats = await call<{ size: number }>(connection, ms, (done) =>
      connection.sftp.stat(path, done),
    );
    return stats.size;
  } catch (error) {
    if (error instanceof StorageError && error.failure === 'not_found') {
      return null;
    }
    throw error;
  }
}

/**
 * The storage's calls on one connection.
 *
 * @param config - The server's settings.
 * @param timeouts - The time limits.
 * @param connection - The connection.
 * @param owned - Whether each call ends with it closed (a single call), or it's a session's.
 * @returns The calls.
 */
function callsOn(
  config: SftpStorageConfig,
  timeouts: SftpTimeouts,
  connection: Connection,
  owned: boolean,
) {
  const marker = posix.join(config.dir, MARKER_FILE);

  /**
   * A file's path, for a key this module made.
   *
   * @param key - The key.
   * @returns Its path under the folder.
   */
  const pathOf = (key: string) => {
    assertStorageKey(key);
    return posix.join(config.dir, key);
  };

  /** Refuses to go on in a folder without the marker. */
  const assertMarked = async () => {
    if ((await sizeOf(connection, marker, timeouts.call)) === null) {
      throw new StorageError('not_set_up');
    }
  };

  /**
   * Makes the folders under the storage's folder down to a file's, where they're missing.
   *
   * @param path - The file's path.
   */
  const makeFolders = async (path: string) => {
    const parts = posix.relative(config.dir, posix.dirname(path)).split('/');
    let folder = config.dir;
    for (const part of parts) {
      folder = posix.join(folder, part);
      // One after another: each folder needs the one above it.
      // eslint-disable-next-line no-await-in-loop -- each folder needs its parent first
      if ((await sizeOf(connection, folder, timeouts.call)) === null) {
        const made = folder;
        // eslint-disable-next-line no-await-in-loop -- each folder needs its parent first
        await call(connection, timeouts.call, (done) => connection.sftp.mkdir(made, done));
      }
    }
  };

  return {
    /** Writes the marker unless it's there. */
    async setUp() {
      if ((await sizeOf(connection, marker, timeouts.call)) === null) {
        await call(connection, timeouts.call, (done) =>
          connection.sftp.writeFile(marker, MARKER_TEXT, done),
        );
      }
    },

    /**
     * Whether the folder has the marker.
     *
     * @returns Whether it has.
     */
    async isSetUp() {
      return (await sizeOf(connection, marker, timeouts.call)) !== null;
    },

    /**
     * Stores a file, in a folder with the marker: beside its place first,
     * then renamed into it, so nobody reads half a file.
     *
     * @param key - Where.
     * @param bytes - The file.
     */
    async put(key: string, bytes: Uint8Array<ArrayBuffer>) {
      const path = pathOf(key);
      await assertMarked();
      await makeFolders(path);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await call(connection, timeouts.put, (done) =>
          connection.sftp.writeFile(
            temporary,
            Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
            done,
          ),
        );
        await call(connection, timeouts.call, (done) =>
          connection.sftp.rename(temporary, path, done),
        );
      } catch (error) {
        // Nothing finds a temporary file later: it goes now, if the connection still can.
        await call(connection, timeouts.call, (done) =>
          connection.sftp.unlink(temporary, done),
        ).catch(() => {});
        throw error;
      }
    },

    /**
     * Reads a file. A single call's connection stays open until the file's
     * stream ends or is cancelled.
     *
     * @param key - Where.
     * @returns The file and its size, or `null` when it isn't there.
     */
    async get(key: string) {
      const path = pathOf(key);
      await assertMarked();
      const size = await sizeOf(connection, path, timeouts.call);
      if (size === null) {
        return null;
      }
      const source = Readable.toWeb(
        connection.sftp.createReadStream(path),
      ) as ReadableStream<Uint8Array>;
      return {
        body: withIdleLimit(source, timeouts.idle, owned ? connection.end : undefined),
        size,
      };
    },

    /**
     * Reads a part of a file. A single call's connection stays open until
     * the part's stream ends or is cancelled.
     *
     * @param key - Where.
     * @param range - The part.
     * @returns The part, or `null` when the file isn't there.
     */
    async getPart(key: string, range: RangeRequest) {
      const path = pathOf(key);
      await assertMarked();
      const size = await sizeOf(connection, path, timeouts.call);
      if (size === null) {
        return null;
      }
      const part = resolveRange(range, size);
      if (!part) {
        // A single call's connection closes as nothing is read (`once`'s `keepOpen`).
        return { unsatisfiable: true as const, total: size };
      }
      const source = Readable.toWeb(
        connection.sftp.createReadStream(path, { start: part.start, end: part.end }),
      ) as ReadableStream<Uint8Array>;
      return {
        body: withIdleLimit(source, timeouts.idle, owned ? connection.end : undefined),
        ...part,
        total: size,
      };
    },

    /**
     * Deletes a file; one that isn't there counts as deleted.
     *
     * @param key - Where.
     */
    async delete(key: string) {
      const path = pathOf(key);
      await assertMarked();
      try {
        await call(connection, timeouts.call, (done) => connection.sftp.unlink(path, done));
      } catch (error) {
        if (!(error instanceof StorageError && error.failure === 'not_found')) {
          throw error;
        }
      }
    },
  };
}

/**
 * A storage in a folder on an SFTP server.
 *
 * @param config - The server's settings.
 * @param timeouts - The time limits; the tests shorten them.
 * @returns The storage.
 */
export default function sftpStorage(
  config: SftpStorageConfig,
  timeouts: SftpTimeouts = TIMEOUTS,
): FileStorage {
  /**
   * Runs one call on a connection of its own.
   *
   * @param work - The call.
   * @param keepOpen - Whether the call's result keeps the connection open (a file being read).
   * @returns What the call gives.
   */
  const once = async <T>(
    work: (calls: ReturnType<typeof callsOn>) => Promise<T>,
    keepOpen: (result: T) => boolean = () => false,
  ): Promise<T> => {
    const connection = await connect(config, timeouts);
    let result: T | undefined;
    try {
      result = await work(callsOn(config, timeouts, connection, true));
      return result;
    } finally {
      if (result === undefined || !keepOpen(result)) {
        connection.end();
      }
    }
  };

  return {
    driver: 'sftp',

    /**
     * Stores a file on a connection of its own.
     *
     * @param key - Where.
     * @param bytes - The file.
     * @returns When it's stored.
     */
    put: (key, bytes) => once((calls) => calls.put(key, bytes)),

    /**
     * Reads a file; its connection closes when the read ends.
     *
     * @param key - Where.
     * @returns The file, or `null` when it isn't there.
     */
    get: (key) =>
      once(
        (calls) => calls.get(key),
        (file) => file !== null,
      ),

    /**
     * Reads a part of a file; its connection closes when the read ends.
     *
     * @param key - Where.
     * @param range - The part.
     * @returns The part, or `null` when the file isn't there.
     */
    getPart: (key, range) =>
      once(
        (calls) => calls.getPart(key, range),
        (part) => part !== null && !('unsatisfiable' in part),
      ),

    /**
     * Deletes a file on a connection of its own.
     *
     * @param key - Where.
     * @returns When it's deleted.
     */
    delete: (key) => once((calls) => calls.delete(key)),

    /**
     * Writes the marker on a connection of its own.
     *
     * @returns When it's there.
     */
    setUp: () => once((calls) => calls.setUp()),

    /**
     * Looks for the marker on a connection of its own.
     *
     * @returns Whether it's there.
     */
    isSetUp: () => once((calls) => calls.isSetUp()),

    /**
     * Runs several calls on one connection, closed when they're done (a
     * file read in a session must be read before it ends).
     *
     * @param work - The calls.
     * @returns What they return.
     */
    async session(work) {
      const connection = await connect(config, timeouts);
      try {
        const calls = callsOn(config, timeouts, connection, false);
        const shared: FileStorage = {
          driver: 'sftp',
          put: calls.put,
          get: calls.get,
          getPart: calls.getPart,
          delete: calls.delete,
          setUp: calls.setUp,
          isSetUp: calls.isSetUp,
          /**
           * Runs more calls on the same connection.
           *
           * @param more - The calls.
           * @returns What they return.
           */
          session: (more) => more(shared),
        };
        return await work(shared);
      } finally {
        connection.end();
      }
    },
  };
}
