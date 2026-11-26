/**
 * @file Tests for the S3 driver's requests and how it reads replies, with
 * `fetch` replaced: where a key goes in each address style, what an upload
 * is signed with, and the kind of failure each reply or error becomes. The
 * driver against a real S3 server is in `s3.int.test.ts`.
 * @vitest-environment node
 */
import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { S3StorageConfig } from '@/lib/storage';

import { attachmentKey } from './keys';
import bucketStorage, { type BucketTimeouts } from './s3';

/** An ID as the database makes one. */
const ID = '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a';

/** A bucket's settings. */
const config: S3StorageConfig = {
  driver: 's3',
  endpoint: 'https://files.adiutor.test',
  region: 'auto',
  bucket: 'adiutor',
  accessKeyId: 'key-id',
  secretAccessKey: 'key-secret',
  forcePathStyle: false,
};

/** Short time limits, so the tests don't wait. */
const quick: BucketTimeouts = { put: 200, firstByte: 50, idle: 50, delete: 200 };

/**
 * An S3 error reply.
 *
 * @param status - Its status.
 * @param code - Its error code.
 * @returns The reply.
 */
function errorReply(status: number, code: string): Response {
  return new Response(`<?xml version="1.0"?><Error><Code>${code}</Code></Error>`, { status });
}

/**
 * Replaces `fetch`, keeping every request it's given.
 *
 * @param reply - What it answers each request with.
 * @returns The requests it was given.
 */
function stubFetch(reply: (request: Request) => Promise<Response> | Response): Request[] {
  const requests: Request[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input as Request;
    requests.push(request);
    return reply(request);
  });
  return requests;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bucketStorage', () => {
  it('puts the bucket in the host name, or in the path, after any path the endpoint has', async () => {
    const requests = stubFetch(() => new Response(null, { status: 200 }));
    await bucketStorage(config).delete(attachmentKey(ID));
    await bucketStorage({
      ...config,
      endpoint: 'http://localhost:8333/s3/',
      forcePathStyle: true,
    }).delete(attachmentKey(ID));

    expect(requests.map((request) => request.url)).toEqual([
      `https://adiutor.files.adiutor.test/attachments/3a/${ID}`,
      `http://localhost:8333/s3/adiutor/attachments/3a/${ID}`,
    ]);
  });

  it('signs an upload with its type and its SHA-256', async () => {
    const requests = stubFetch(() => new Response(null, { status: 200 }));
    const bytes = new TextEncoder().encode('printer log');
    await bucketStorage(config).put(attachmentKey(ID), bytes, 'text/plain');

    const [request] = requests;
    expect(request?.method).toBe('PUT');
    expect(request?.headers.get('content-type')).toBe('text/plain');
    expect(request?.headers.get('x-amz-content-sha256')).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(request?.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=key-id\/\d{8}\/auto\/s3\/aws4_request/,
    );
  });

  it('reads a file with its size, and a missing one as nothing', async () => {
    stubFetch((request) =>
      request.url.endsWith(ID)
        ? new Response('printer log', { headers: { 'Content-Length': '11' } })
        : errorReply(404, 'NoSuchKey'),
    );
    const file = await bucketStorage(config).get(attachmentKey(ID));
    expect(file?.size).toBe(11);
    expect(file && (await new Response(file.body).text())).toBe('printer log');

    expect(await bucketStorage(config).get(attachmentKey(ID.replace(/a$/, 'b')))).toBeNull();
  });

  it('takes a delete of a missing file as done', async () => {
    stubFetch(() => errorReply(404, 'NoSuchKey'));
    await expect(bucketStorage(config).delete(attachmentKey(ID))).resolves.toBeUndefined();
  });

  it.each([
    ['refused keys', () => errorReply(403, 'SignatureDoesNotMatch'), 'refused'],
    ['a missing bucket', () => errorReply(404, 'NoSuchBucket'), 'not_found'],
    ['a client error', () => errorReply(400, 'InvalidRequest'), 'failed'],
  ])('names %s by its kind only', async (_, reply, failure) => {
    stubFetch(reply);
    const storage = bucketStorage(config, quick);
    await expect(
      storage.put(attachmentKey(ID), new Uint8Array([1]), 'image/png'),
    ).rejects.toMatchObject({
      failure,
      message: `The file storage failed: ${failure}.`,
    });
    if (failure !== 'failed') {
      await expect(storage.get(attachmentKey(ID))).rejects.toMatchObject({ failure });
      await expect(storage.delete(attachmentKey(ID))).rejects.toMatchObject({ failure });
    }
  });

  it('reads only the start of an error reply, however much follows', async () => {
    // A code at the start, then far more than is ever read, sent as it's asked for.
    let piecesSent = 0;
    stubFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            /**
             * Sends the next piece: the code first, then filler that never ends.
             *
             * @param controller - The stream's controller.
             */
            pull(controller) {
              piecesSent += 1;
              controller.enqueue(
                new TextEncoder().encode(
                  piecesSent === 1 ? '<Error><Code>NoSuchBucket</Code>' : 'x'.repeat(1024),
                ),
              );
            },
          }),
          { status: 404 },
        ),
    );

    await expect(
      bucketStorage(config, quick).put(attachmentKey(ID), new Uint8Array([1]), 'image/png'),
    ).rejects.toMatchObject({ failure: 'not_found' });
    expect(piecesSent).toBeLessThan(10);
  });

  it('says a storage is unreachable when there is no connection', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(bucketStorage(config, quick).get(attachmentKey(ID))).rejects.toMatchObject({
      failure: 'unreachable',
    });
  });

  it('gives up on a reply that takes too long', async () => {
    stubFetch(
      (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason));
        }),
    );
    const storage = bucketStorage(config, quick);
    await expect(storage.get(attachmentKey(ID))).rejects.toMatchObject({ failure: 'timed_out' });
    await expect(storage.delete(attachmentKey(ID))).rejects.toMatchObject({ failure: 'timed_out' });
  });
});
