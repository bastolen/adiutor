/**
 * @file Tests for the SFTP driver against a real SFTP server: the OpenSSH
 * service in `compose.yaml` (`pnpm services:up`, and in CI). Each test has a
 * folder of its own there. The driver keeps one connection for its calls
 * (an upload has one of its own), closes it once nothing has used it for a
 * while (shortened here), and runs a call once more on a new one when the
 * kept one turns out dead.
 */
import { randomUUID } from 'node:crypto';

import type { SFTPWrapper } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RangeRequest } from '@/lib/request/byte-range';
import type { SftpStorageConfig } from '@/lib/storage';

import { testSftpFolder } from '../../../tests/integration/helpers';
import { attachmentKey } from './keys';
import sftpStorage, { connectSftp, type SftpTimeouts } from './sftp';
import type { Connection } from './sftp-connection';
import type { FileStorage } from './types';

/** The time limits in these tests: a connection nothing uses closes after 300 ms. */
const SHORT: SftpTimeouts = {
  connect: 10_000,
  call: 15_000,
  put: 120_000,
  idle: 30_000,
  keep: 300,
};

/** How long a test waits for a connection to close: well past {@link SHORT}'s `keep`. */
const UNTIL_CLOSED = { timeout: 5_000 };

/**
 * A connection whose next look (`stat`) goes wrong, the way a test chooses.
 *
 * @param connection - The connection.
 * @param next - What the next look does instead, given the connection and the look itself.
 * @returns The connection, and a switch that arms the next look.
 */
function sabotaged(
  connection: Connection,
  next: (connection: Connection, look: () => void) => void,
): Connection & { arm: () => void } {
  let armed = false;
  const sftp = new Proxy(connection.sftp, {
    /**
     * The channel's calls, the armed look going wrong.
     *
     * @param target - The channel.
     * @param property - The call.
     * @param receiver - The proxy.
     * @returns The call.
     */
    get(target, property, receiver) {
      if (property === 'stat' && armed) {
        armed = false;
        return (...args: Parameters<SFTPWrapper['stat']>) =>
          next(connection, () => target.stat(...args));
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    sftp,
    end: connection.end,
    /**
     * Whether it has ended.
     *
     * @returns Whether it has.
     */
    get closed() {
      return connection.closed;
    },
    onClose: connection.onClose,
    /** Arms the next look. */
    arm: () => {
      armed = true;
    },
  };
}

/** The storages a test made, closed after it. */
const made: FileStorage[] = [];

afterEach(() => {
  made.splice(0).forEach((storage) => storage.close());
});

/**
 * A storage that's closed after the test, with the connections it opened to
 * watch.
 *
 * @param config - The server's settings.
 * @param wrap - Changes each connection as it opens, to make one fail.
 * @param limits - The time limits, {@link SHORT} unless a test needs others.
 * @returns The storage and its connections.
 */
function watched(
  config: SftpStorageConfig,
  wrap: (connection: Connection) => Connection = (connection) => connection,
  limits: SftpTimeouts = SHORT,
) {
  const connections: Connection[] = [];
  const storage = sftpStorage(config, limits, async (settings, timeouts) => {
    const connection = wrap(await connectSftp(settings, timeouts));
    connections.push(connection);
    return connection;
  });
  made.push(storage);
  return { storage, connections };
}

/**
 * Settings for a new folder on the test server.
 *
 * @returns The settings.
 */
function newFolder() {
  return testSftpFolder(`/config/attachments-${randomUUID()}`);
}

/**
 * Reads a stored file's text.
 *
 * @param body - Its stream.
 * @returns Its text.
 */
async function textOf(body: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(body).text();
}

/**
 * Reads a part of a stored file as text, or says why there's none.
 *
 * @param storage - The storage.
 * @param key - The file's key.
 * @param range - The part.
 * @returns The part's text and place, `unsatisfiable` with the size, or `null`.
 */
async function partOf(
  storage: FileStorage,
  key: string,
  range: RangeRequest,
): Promise<
  | { text: string; start: number; end: number; total: number }
  | { unsatisfiable: true; total: number | null }
  | null
> {
  const part = await storage.getPart(key, range);
  if (!part || 'unsatisfiable' in part) {
    return part;
  }
  return {
    text: await new Response(part.body).text(),
    start: part.start,
    end: part.end,
    total: part.total,
  };
}

describe('sftpStorage on an SFTP server', () => {
  it('stores a file once the folder is set up, reads it back and deletes it', async () => {
    const { storage } = watched(await newFolder());
    await storage.setUp();
    expect(await storage.isSetUp()).toBe(true);
    const key = attachmentKey(randomUUID());
    await storage.put(key, new TextEncoder().encode('printer log'), 'text/plain');

    const file = await storage.get(key);
    expect(file?.size).toBe(11);
    expect(file && (await textOf(file.body))).toBe('printer log');

    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it('reads a part of a file, from a byte to a byte, to the end or its last bytes', async () => {
    const { storage } = watched(await newFolder());
    await storage.setUp();
    const key = attachmentKey(randomUUID());
    await storage.put(key, new TextEncoder().encode('printer log'), 'text/plain');

    expect(await partOf(storage, key, { start: 2, end: 5 })).toEqual({
      text: 'inte',
      start: 2,
      end: 5,
      total: 11,
    });
    expect(await partOf(storage, key, { start: 8, end: null })).toMatchObject({
      text: 'log',
      end: 10,
    });
    expect(await partOf(storage, key, { suffix: 3 })).toMatchObject({ text: 'log', start: 8 });
    expect(await partOf(storage, key, { start: 0, end: 999 })).toMatchObject({
      text: 'printer log',
    });
    expect(await partOf(storage, key, { start: 11, end: null })).toMatchObject({
      unsatisfiable: true,
    });
    expect(await storage.getPart(attachmentKey(randomUUID()), { start: 0, end: null })).toBeNull();
  });

  it('shares one connection in a session', async () => {
    const { storage } = watched(await newFolder());
    const keys = [attachmentKey(randomUUID()), attachmentKey(randomUUID())];
    await storage.session(async (shared) => {
      await shared.setUp();
      for (const key of keys) {
        // eslint-disable-next-line no-await-in-loop -- one connection, one call at a time
        await shared.put(key, new Uint8Array([1, 2, 3]), 'application/octet-stream');
      }
      for (const key of keys) {
        // eslint-disable-next-line no-await-in-loop -- one connection, one call at a time
        await shared.delete(key);
      }
    });
    expect(await storage.get(keys[0] ?? '')).toBeNull();
  });

  it('keeps one connection for calls in a row, and closes it once nothing has used it for a while', async () => {
    const { storage, connections } = watched(await newFolder());
    await storage.setUp();
    const key = attachmentKey(randomUUID());
    // An upload has a connection of its own, ended once it's stored.
    const beforeUpload = connections.length;
    await storage.put(key, new TextEncoder().encode('printer log'), 'text/plain');
    expect(connections).toHaveLength(beforeUpload + 1);
    await vi.waitFor(() => expect(connections.at(-1)?.closed).toBe(true), UNTIL_CLOSED);

    // The calls after it share one: the kept one, or one new one if that closed meanwhile.
    const beforeCalls = connections.length;
    const file = await storage.get(key);
    expect(file && (await textOf(file.body))).toBe('printer log');
    expect(await partOf(storage, key, { start: 0, end: 6 })).toMatchObject({ text: 'printer' });
    expect(await partOf(storage, key, { start: 8, end: null })).toMatchObject({ text: 'log' });
    await storage.delete(key);
    expect(connections.length - beforeCalls).toBeLessThanOrEqual(1);

    // Once nothing has used it for a while, it closes, and the next call opens another.
    await vi.waitFor(
      () => expect(connections.every(({ closed }) => closed)).toBe(true),
      UNTIL_CLOSED,
    );
    const beforeLast = connections.length;
    expect(await storage.isSetUp()).toBe(true);
    expect(connections).toHaveLength(beforeLast + 1);
  });

  it('holds the connection while a file is read, and lets go once the read ends', async () => {
    const { storage, connections } = watched(await newFolder());
    await storage.setUp();
    const key = attachmentKey(randomUUID());
    await storage.put(key, new TextEncoder().encode('printer log'), 'text/plain');
    // The read opens a connection of its own once the others have closed.
    await vi.waitFor(
      () => expect(connections.every(({ closed }) => closed)).toBe(true),
      UNTIL_CLOSED,
    );
    const file = await storage.get(key);
    const reading = connections.at(-1);

    await new Promise((resolve) => {
      setTimeout(resolve, SHORT.keep * 3);
    });
    expect(reading?.closed).toBe(false);

    expect(file && (await textOf(file.body))).toBe('printer log');
    await vi.waitFor(() => expect(reading?.closed).toBe(true), UNTIL_CLOSED);
  });

  it('runs a call once more on a new connection when the kept one went meanwhile', async () => {
    const wrapped: ReturnType<typeof sabotaged>[] = [];
    const { storage, connections } = watched(await newFolder(), (connection) => {
      // The connection goes as the next look starts on it, as when the server restarted while it
      // was kept: its end isn't noticed until then.
      const one = sabotaged(connection, (gone, look) => {
        gone.end();
        look();
      });
      wrapped.push(one);
      return one;
    });
    await storage.setUp();
    wrapped[0]?.arm();

    expect(await storage.isSetUp()).toBe(true);
    expect(connections).toHaveLength(2);
    expect(connections[0]?.closed).toBe(true);
  });

  it('runs a call once more on a new connection when the kept one stops answering', async () => {
    const wrapped: ReturnType<typeof sabotaged>[] = [];
    const { storage, connections } = watched(
      await newFolder(),
      (connection) => {
        // The next look gets no answer at all.
        const one = sabotaged(connection, () => {});
        wrapped.push(one);
        return one;
      },
      { ...SHORT, call: 500, keep: 60_000 },
    );
    await storage.setUp();
    wrapped[0]?.arm();

    expect(await storage.isSetUp()).toBe(true);
    expect(connections).toHaveLength(2);
    await vi.waitFor(() => expect(connections[0]?.closed).toBe(true), UNTIL_CLOSED);
  });

  it('doesn’t run a call again on a connection opened for it', async () => {
    const { storage, connections } = watched(await newFolder(), (connection) => {
      const one = sabotaged(connection, (gone, look) => {
        gone.end();
        look();
      });
      one.arm();
      return one;
    });

    await expect(storage.isSetUp()).rejects.toMatchObject({ failure: 'failed' });
    expect(connections).toHaveLength(1);
  });

  it('ends its connection when closed, once the read that holds it ends', async () => {
    const { storage, connections } = watched(await newFolder());
    await storage.setUp();
    const key = attachmentKey(randomUUID());
    await storage.put(key, new TextEncoder().encode('printer log'), 'text/plain');
    await vi.waitFor(
      () => expect(connections.every(({ closed }) => closed)).toBe(true),
      UNTIL_CLOSED,
    );
    const file = await storage.get(key);
    const reading = connections.at(-1);

    storage.close();
    expect(reading?.closed).toBe(false);
    expect(file && (await textOf(file.body))).toBe('printer log');
    await vi.waitFor(() => expect(reading?.closed).toBe(true), UNTIL_CLOSED);
  });

  it('refuses to store, read or delete in a folder that isn’t set up', async () => {
    const { storage, connections } = watched(await newFolder(), undefined, {
      ...SHORT,
      keep: 60_000,
    });
    expect(await storage.isSetUp()).toBe(false);
    await expect(
      storage.put(attachmentKey(randomUUID()), new Uint8Array([1]), 'image/png'),
    ).rejects.toMatchObject({ failure: 'not_set_up' });
    // Storing never marks it.
    expect(await storage.isSetUp()).toBe(false);
    await expect(storage.get(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'not_set_up',
    });
    await expect(storage.delete(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'not_set_up',
    });
    // The server's own answers aren't run again: the kept connection, and the upload's own.
    expect(connections).toHaveLength(2);
  });

  it('can’t set up a folder that isn’t there', async () => {
    const config = await newFolder();
    const { storage } = watched({ ...config, dir: `${config.dir}/missing` });
    await expect(storage.setUp()).rejects.toMatchObject({ failure: 'not_found' });
  });

  it('refuses a server whose host key isn’t the one expected', async () => {
    const config = await newFolder();
    const { storage } = watched({ ...config, hostKey: `SHA256:${'A'.repeat(43)}` });
    await expect(storage.get(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'host_key',
    });
  });

  it('is refused with the wrong password', async () => {
    const config = await newFolder();
    const { storage } = watched({ ...config, password: 'not-the-password' });
    await expect(storage.get(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'refused',
    });
  });

  it('says a server that doesn’t answer is unreachable', async () => {
    const config = await newFolder();
    const { storage } = watched({ ...config, port: 9 });
    await expect(storage.get(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'unreachable',
    });
  });
});
