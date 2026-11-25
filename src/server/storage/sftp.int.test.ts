/**
 * @file Tests for the SFTP driver against a real SFTP server: the OpenSSH
 * service in `compose.yaml` (`pnpm services:up`, and in CI). Each test has a
 * folder of its own there.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { testSftpFolder } from '../../../tests/integration/helpers';
import { attachmentKey } from './keys';
import sftpStorage from './sftp';

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

describe('sftpStorage on an SFTP server', () => {
  it('stores a file, reads it back and deletes it', async () => {
    const storage = sftpStorage(await newFolder());
    const key = attachmentKey(randomUUID());
    await storage.put(key, new TextEncoder().encode('printer log'), 'text/plain');

    const file = await storage.get(key);
    expect(file?.size).toBe(11);
    expect(file && (await textOf(file.body))).toBe('printer log');

    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it('shares one connection in a session', async () => {
    const storage = sftpStorage(await newFolder());
    const keys = [attachmentKey(randomUUID()), attachmentKey(randomUUID())];
    await storage.session(async (shared) => {
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

  it('refuses to read or delete in a folder without the marker', async () => {
    const storage = sftpStorage(await newFolder());
    await expect(storage.get(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'not_set_up',
    });
    await expect(storage.delete(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'not_set_up',
    });
  });

  it('says a folder that isn’t there is missing', async () => {
    const config = await newFolder();
    const storage = sftpStorage({ ...config, dir: `${config.dir}/missing` });
    await expect(
      storage.put(attachmentKey(randomUUID()), new Uint8Array([1]), 'image/png'),
    ).rejects.toMatchObject({ failure: 'not_found' });
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
