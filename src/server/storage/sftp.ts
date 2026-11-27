/**
 * @file The SFTP driver: files in a folder on another server, at their key
 * under it, over SSH (`ssh2`). Every connection checks the server's host key
 * against the fingerprint it was given, and a connection to any other key
 * is refused. Like the local disk, the folder has a marker file: storing,
 * reading and deleting refuse without it, and only setting the storage up
 * writes it (`setUp`). The driver keeps one connection that its calls share
 * (`sftp-connection.ts`, decision 0059): a file being read holds it until the
 * read ends, a session (a job's run) for all of its calls, and once nothing
 * has used it for a minute it closes. A call that finds the kept connection
 * ended meanwhile runs once more on a new one. An upload has a connection of
 * its own, as it may take minutes: one that runs out of time ends only that.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { Readable } from 'node:stream';

import { Client } from 'ssh2';

import { type RangeRequest, resolveRange } from '@/lib/request/byte-range';
import type { SftpStorageConfig } from '@/lib/storage';

import { StorageError } from './errors';
import withIdleLimit from './idle-limit';
import { assertStorageKey } from './keys';
import { MARKER_FILE } from './local';
import sharedConnection, { type Connection, type Lease } from './sftp-connection';
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
  /** How long the connection stays open once nothing uses it. */
  keep: number;
}

/** The time limits a server uses. */
const TIMEOUTS: SftpTimeouts = {
  connect: 10_000,
  call: 15_000,
  put: 120_000,
  idle: 30_000,
  keep: 60_000,
};

/**
 * How often a kept connection asks the server whether it's there, and how
 * many unanswered asks end it (about 30 seconds), so a server that went away
 * is noticed while the connection waits for its next use.
 */
const KEEPALIVE = { interval: 15_000, countMax: 1 };

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

/**
 * Connects to the server and opens SFTP on it, checking its host key.
 *
 * @param config - The server's settings.
 * @param timeouts - The time limits.
 * @returns The connection.
 */
export function connectSftp(
  config: SftpStorageConfig,
  timeouts: SftpTimeouts,
): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let hostKeyRefused = false;
    let open = false;
    let closed = false;
    const closeListeners: (() => void)[] = [];
    /** Marks it ended, once, and tells whoever keeps it. */
    const markClosed = () => {
      if (!closed) {
        closed = true;
        closeListeners.splice(0).forEach((listener) => listener());
      }
    };
    // Kept for the connection's life: an `error` event without a listener would crash the server.
    client.on('error', (error) => {
      if (!open) {
        reject(connectionError(error, hostKeyRefused));
      }
    });
    // However it ends (here, by the server, or the network), whoever keeps it hears of it.
    client.on('close', markClosed);
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
        // The SFTP channel alone can end too: the connection is no use without it.
        sftp.once('close', () => {
          markClosed();
          client.end();
        });
        resolve({
          sftp,
          /** Ends the connection: ended from now on, whenever its socket closes. */
          end: () => {
            markClosed();
            client.end();
          },
          /**
           * Whether it has ended.
           *
           * @returns Whether it has.
           */
          get closed() {
            return closed;
          },
          /**
           * Calls a listener once it has ended.
           *
           * @param listener - What to call.
           */
          onClose: (listener) => {
            if (closed) {
              listener();
            } else {
              closeListeners.push(listener);
            }
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
      keepaliveInterval: KEEPALIVE.interval,
      keepaliveCountMax: KEEPALIVE.countMax,
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
 * Runs an SFTP call with a time limit; past it, the call fails and its
 * connection is told (`timedOut`), which stops trusting it.
 *
 * @param ms - The time limit.
 * @param timedOut - Called when the call runs out of time.
 * @param run - Starts the call, given its callback.
 * @returns What the call gives.
 */
function call<T>(
  ms: number,
  timedOut: () => void,
  run: (done: (error: Error | null | undefined, value?: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new StorageError('timed_out'));
      timedOut();
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
 * Whether a call failed because its connection did, not because the server
 * answered no (a file that isn't there, a folder without the marker): it
 * timed out, or failed without one of SFTP's status codes (the channel or
 * the socket went).
 *
 * @param error - What the call failed with.
 * @returns Whether it did.
 */
function connectionFailed(error: unknown): boolean {
  if (!(error instanceof StorageError)) {
    return false;
  }
  if (error.failure === 'timed_out') {
    return true;
  }
  return (
    error.failure === 'failed' &&
    typeof (error.cause as { code?: unknown } | undefined)?.code !== 'number'
  );
}

/**
 * Whether a path exists on the server.
 *
 * @param connection - The connection.
 * @param path - The path.
 * @param ms - The time limit.
 * @param timedOut - Called when the look runs out of time.
 * @returns Its size when it's there, else `null`.
 */
async function sizeOf(
  connection: Connection,
  path: string,
  ms: number,
  timedOut: () => void,
): Promise<number | null> {
  try {
    const stats = await call<{ size: number }>(ms, timedOut, (done) =>
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
 * @param hooks - What the calls tell their caller.
 * @param hooks.timedOut - Called when a call on the connection runs out of time.
 * @param hooks.readEnded - Called once a file that's read stops being read (a single call lets go
 *   of the connection then); none for a session's calls, which hold it until the session ends.
 * @returns The calls.
 */
function callsOn(
  config: SftpStorageConfig,
  timeouts: SftpTimeouts,
  connection: Connection,
  { timedOut, readEnded }: { timedOut: () => void; readEnded?: () => void },
) {
  const marker = posix.join(config.dir, MARKER_FILE);

  /**
   * Whether a path is there, on this connection.
   *
   * @param path - The path.
   * @returns Its size when it's there, else `null`.
   */
  const look = (path: string) => sizeOf(connection, path, timeouts.call, timedOut);

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
    if ((await look(marker)) === null) {
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
      if ((await look(folder)) === null) {
        const made = folder;
        // eslint-disable-next-line no-await-in-loop -- each folder needs its parent first
        await call(timeouts.call, timedOut, (done) => connection.sftp.mkdir(made, done));
      }
    }
  };

  return {
    /** Writes the marker unless it's there. */
    async setUp() {
      if ((await look(marker)) === null) {
        await call(timeouts.call, timedOut, (done) =>
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
      return (await look(marker)) !== null;
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
        await call(timeouts.put, timedOut, (done) =>
          connection.sftp.writeFile(
            temporary,
            Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
            done,
          ),
        );
        await call(timeouts.call, timedOut, (done) =>
          connection.sftp.rename(temporary, path, done),
        );
      } catch (error) {
        // Nothing finds a temporary file later: it goes now, if the connection still can.
        await call(timeouts.call, timedOut, (done) =>
          connection.sftp.unlink(temporary, done),
        ).catch(() => {});
        throw error;
      }
    },

    /**
     * Reads a file. A single call holds the connection until the file's
     * stream ends or is cancelled.
     *
     * @param key - Where.
     * @returns The file and its size, or `null` when it isn't there.
     */
    async get(key: string) {
      const path = pathOf(key);
      await assertMarked();
      const size = await look(path);
      if (size === null) {
        return null;
      }
      const source = Readable.toWeb(
        connection.sftp.createReadStream(path),
      ) as ReadableStream<Uint8Array>;
      return {
        body: withIdleLimit(source, timeouts.idle, readEnded),
        size,
      };
    },

    /**
     * Reads a part of a file. A single call holds the connection until the
     * part's stream ends or is cancelled.
     *
     * @param key - Where.
     * @param range - The part.
     * @returns The part, or `null` when the file isn't there.
     */
    async getPart(key: string, range: RangeRequest) {
      const path = pathOf(key);
      await assertMarked();
      const size = await look(path);
      if (size === null) {
        return null;
      }
      const part = resolveRange(range, size);
      if (!part) {
        // Nothing is read, so a single call lets go of the connection at once (`run`'s `holds`).
        return { unsatisfiable: true as const, total: size };
      }
      const source = Readable.toWeb(
        connection.sftp.createReadStream(path, { start: part.start, end: part.end }),
      ) as ReadableStream<Uint8Array>;
      return {
        body: withIdleLimit(source, timeouts.idle, readEnded),
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
        await call(timeouts.call, timedOut, (done) => connection.sftp.unlink(path, done));
      } catch (error) {
        if (!(error instanceof StorageError && error.failure === 'not_found')) {
          throw error;
        }
      }
    },
  };
}

/**
 * A storage in a folder on an SFTP server. Its calls share the connection it
 * keeps (`sharedConnection`); `close` ends it once its uses are done.
 *
 * @param config - The server's settings.
 * @param timeouts - The time limits; the tests shorten them.
 * @param connect - Opens a connection; the tests watch it.
 * @returns The storage.
 */
export default function sftpStorage(
  config: SftpStorageConfig,
  timeouts: SftpTimeouts = TIMEOUTS,
  connect: typeof connectSftp = connectSftp,
): FileStorage {
  const kept = sharedConnection(() => connect(config, timeouts), timeouts.keep);

  /**
   * Runs one call on the kept connection, holding it for as long as the
   * call's result needs it (a file being read). A call that fails as the
   * connection does (it ran out of time, or the channel or the socket went:
   * `connectionFailed`) stops it being kept, so it ends once the reads still
   * on it are done; when the connection was kept from an earlier use (the
   * server restarted, or the network dropped it while it waited), the call
   * runs once more on a new one: every call here is safe to repeat (a look, a
   * read, a delete, the marker). A failure the server answers with, such as a
   * file that isn't there, leaves the connection kept and isn't repeated.
   *
   * @param work - The call.
   * @param holds - Whether the call's result holds the connection (a file being read).
   * @returns What the call gives.
   */
  const run = async <T>(
    work: (calls: ReturnType<typeof callsOn>) => Promise<T>,
    holds: (result: T) => boolean = () => false,
  ): Promise<T> => {
    /**
     * Runs the call on a use of the connection.
     *
     * @param lease - The use.
     * @returns What the call gives.
     */
    const attempt = async (lease: Lease): Promise<T> => {
      let held = false;
      try {
        const result = await work(
          callsOn(config, timeouts, lease.connection, {
            timedOut: lease.discard,
            readEnded: lease.release,
          }),
        );
        held = holds(result);
        return result;
      } finally {
        if (!held) {
          lease.release();
        }
      }
    };
    const first = await kept.lease();
    try {
      return await attempt(first);
    } catch (error) {
      if (!(first.connection.closed || connectionFailed(error))) {
        throw error;
      }
      first.discard();
      if (first.fresh) {
        throw error;
      }
      return attempt(await kept.lease());
    }
  };

  /** Nothing: a connection of its own ends with its call, just after it runs out of time. */
  const endsWithTheCall = () => {};

  /**
   * Runs one call on a connection of its own, ended when it's done: an
   * upload, which may take minutes, so running out of time ends only its own
   * connection, never the reads that share the kept one. It isn't run again.
   *
   * @param work - The call.
   * @returns What the call gives.
   */
  const alone = async <T>(work: (calls: ReturnType<typeof callsOn>) => Promise<T>): Promise<T> => {
    const connection = await connect(config, timeouts);
    try {
      return await work(callsOn(config, timeouts, connection, { timedOut: endsWithTheCall }));
    } finally {
      connection.end();
    }
  };

  return {
    driver: 'sftp',

    /**
     * Stores a file, on a connection of its own.
     *
     * @param key - Where.
     * @param bytes - The file.
     * @returns When it's stored.
     */
    put: (key, bytes) => alone((calls) => calls.put(key, bytes)),

    /**
     * Reads a file; it holds the connection until the read ends.
     *
     * @param key - Where.
     * @returns The file, or `null` when it isn't there.
     */
    get: (key) =>
      run(
        (calls) => calls.get(key),
        (file) => file !== null,
      ),

    /**
     * Reads a part of a file; it holds the connection until the read ends.
     *
     * @param key - Where.
     * @param range - The part.
     * @returns The part, or `null` when the file isn't there.
     */
    getPart: (key, range) =>
      run(
        (calls) => calls.getPart(key, range),
        (part) => part !== null && !('unsatisfiable' in part),
      ),

    /**
     * Deletes a file.
     *
     * @param key - Where.
     * @returns When it's deleted.
     */
    delete: (key) => run((calls) => calls.delete(key)),

    /**
     * Writes the marker.
     *
     * @returns When it's there.
     */
    setUp: () => run((calls) => calls.setUp()),

    /**
     * Looks for the marker.
     *
     * @returns Whether it's there.
     */
    isSetUp: () => run((calls) => calls.isSetUp()),

    /**
     * Runs several calls on the kept connection, holding it until they're
     * done (a file read in a session must be read before it ends). Not run
     * again when the connection ends: a job's run tries again next time.
     *
     * @param work - The calls.
     * @returns What they return.
     */
    async session(work) {
      const lease = await kept.lease();
      try {
        const calls = callsOn(config, timeouts, lease.connection, { timedOut: lease.discard });
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
          /** Nothing: the session's own storage ends the connection. */
          close: () => {},
        };
        return await work(shared);
      } finally {
        lease.release();
      }
    },

    /** Ends the kept connection once the calls and reads that hold it are done. */
    close() {
      kept.close();
    },
  };
}
