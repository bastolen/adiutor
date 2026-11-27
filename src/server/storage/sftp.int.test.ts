/**
 * @file Tests for the SFTP driver against a real SFTP server: the OpenSSH
 * service in `compose.yaml` (`pnpm services:up`, and in CI). Each test has a
 * folder of its own there.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { RangeRequest } from '@/lib/request/byte-range';

import { testSftpFolder } from '../../../tests/integration/helpers';
import { attachmentKey } from './keys';
import sftpStorage from './sftp';
import type { FileStorage } from './types';

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
    const storage = sftpStorage(await newFolder());
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
    const storage = sftpStorage(await newFolder());
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
    const storage = sftpStorage(await newFolder());
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

  it('refuses to store, read or delete in a folder that isn’t set up', async () => {
    const storage = sftpStorage(await newFolder());
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
  });

  it('can’t set up a folder that isn’t there', async () => {
    const config = await newFolder();
    const storage = sftpStorage({ ...config, dir: `${config.dir}/missing` });
    await expect(storage.setUp()).rejects.toMatchObject({ failure: 'not_found' });
  });

  it('refuses a server whose host key isn’t the one expected', async () => {
    const config = await newFolder();
    const storage = sftpStorage({ ...config, hostKey: `SHA256:${'A'.repeat(43)}` });
    await expect(storage.get(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'host_key',
    });
  });

  it('is refused with the wrong password', async () => {
    const config = await newFolder();
    const storage = sftpStorage({ ...config, password: 'not-the-password' });
    await expect(storage.get(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'refused',
    });
  });

  it('says a server that doesn’t answer is unreachable', async () => {
    const config = await newFolder();
    const storage = sftpStorage({ ...config, port: 9 });
    await expect(storage.get(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'unreachable',
    });
  });
});
