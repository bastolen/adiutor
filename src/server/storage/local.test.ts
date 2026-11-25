/**
 * @file Tests for the local disk driver, in a folder of their own: files go
 * in and come back whole, the marker guards reads and deletes, and failures
 * name only their kind.
 * @vitest-environment node
 */
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { attachmentKey } from './keys';
import diskStorage, { MARKER_FILE } from './local';

/** An ID as the database makes one. */
const ID = '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a';

/** The test's folder. */
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adiutor-disk-'));
});

afterEach(async () => {
  await chmod(dir, 0o700).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

/**
 * Reads a stored file's text.
 *
 * @param body - Its stream.
 * @returns Its text.
 */
async function textOf(body: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(body).text();
}

describe('diskStorage', () => {
  it('stores a file at its key, marks the folder and reads the file back', async () => {
    const storage = diskStorage(dir);
    await storage.put(attachmentKey(ID), new TextEncoder().encode('printer log'), 'text/plain');

    expect(await readFile(join(dir, 'attachments', '3a', ID), 'utf8')).toBe('printer log');
    expect(existsSync(join(dir, MARKER_FILE))).toBe(true);
    // Nothing of the temporary file is left beside it.
    expect(await readdir(join(dir, 'attachments', '3a'))).toEqual([ID]);

    const file = await storage.get(attachmentKey(ID));
    expect(file?.size).toBe(11);
    expect(file && (await textOf(file.body))).toBe('printer log');
  });

  it('says a missing file is missing, and deletes one that is gone without a fuss', async () => {
    const storage = diskStorage(dir);
    await storage.put(attachmentKey(ID), new Uint8Array([1]), 'application/octet-stream');
    await storage.delete(attachmentKey(ID));

    expect(await storage.get(attachmentKey(ID))).toBeNull();
    await expect(storage.delete(attachmentKey(ID))).resolves.toBeUndefined();
  });

  it('refuses to read or delete in a folder without the marker', async () => {
    const storage = diskStorage(dir);
    await expect(storage.get(attachmentKey(ID))).rejects.toMatchObject({ failure: 'not_set_up' });
    await expect(storage.delete(attachmentKey(ID))).rejects.toMatchObject({
      failure: 'not_set_up',
    });
  });

  it('refuses a folder that isn’t there, or can’t be written to', async () => {
    await expect(
      diskStorage(join(dir, 'missing')).put(attachmentKey(ID), new Uint8Array([1]), 'image/png'),
    ).rejects.toMatchObject({ failure: 'not_found' });

    await chmod(dir, 0o500);
    await expect(
      diskStorage(dir).put(attachmentKey(ID), new Uint8Array([1]), 'image/png'),
    ).rejects.toMatchObject({ failure: 'not_writable' });
  });

  it('takes only keys made from IDs', async () => {
    const storage = diskStorage(dir);
    await expect(storage.put('../outside', new Uint8Array([1]), 'image/png')).rejects.toThrow(
      'Not a storage key.',
    );
    await expect(storage.session((inside) => inside.get('attachments/../x'))).rejects.toThrow(
      'Not a storage key.',
    );
  });
});
