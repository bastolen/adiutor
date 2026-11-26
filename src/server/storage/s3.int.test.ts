/**
 * @file Tests for the S3 driver against a real S3-compatible server: the
 * SeaweedFS service in `compose.yaml` (`pnpm services:up`, and in CI), which
 * checks every signature.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { TEST_BUCKET } from '../../../tests/integration/helpers';
import { attachmentKey } from './keys';
import bucketStorage from './s3';

/**
 * Reads a stored file's text.
 *
 * @param body - Its stream.
 * @returns Its text.
 */
async function textOf(body: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(body).text();
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
