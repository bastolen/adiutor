/**
 * @file Tests for the S3 driver against a real S3-compatible server: the
 * SeaweedFS service in `compose.yaml` (`pnpm services:up`, and in CI), which
 * checks every signature.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { RangeRequest } from '@/lib/request/byte-range';

import { TEST_BUCKET } from '../../../tests/integration/helpers';
import { attachmentKey } from './keys';
import bucketStorage from './s3';
import type { FileStorage } from './types';

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

describe('bucketStorage on an S3 server', () => {
  it('stores a file, reads it back and deletes it, a bucket needing no setting up', async () => {
    const storage = bucketStorage(TEST_BUCKET);
    expect(await storage.isSetUp()).toBe(true);
    await expect(storage.setUp()).resolves.toBeUndefined();
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
    const storage = bucketStorage(TEST_BUCKET);

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

  it('is refused with the wrong secret', async () => {
    const storage = bucketStorage({ ...TEST_BUCKET, secretAccessKey: 'not-the-secret' });
    await expect(storage.get(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'refused',
    });
  });

  it('says a bucket that isn’t there is missing', async () => {
    const storage = bucketStorage({ ...TEST_BUCKET, bucket: 'adiutor-no-such-bucket' });
    await expect(storage.get(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'not_found',
    });
  });

  it('says a server that doesn’t answer is unreachable', async () => {
    const storage = bucketStorage({ ...TEST_BUCKET, endpoint: 'http://127.0.0.1:9' });
    await expect(storage.get(attachmentKey(randomUUID()))).rejects.toMatchObject({
      failure: 'unreachable',
    });
  });
});
