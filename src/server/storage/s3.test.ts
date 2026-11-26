/**
 * @file Tests for the S3 driver's requests and how it reads replies, with
 * `fetch` replaced: where a key goes in each address style, what an upload
 * is signed with, and the kind of failure each reply or error becomes. The
 * driver against a real S3 server is in `s3.int.test.ts`.
 * @vitest-environment node
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
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
const quick: BucketTimeouts = { put: 200, firstByte: 50, idle: 50, delete: 200, retry: 1 };

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
 * Replaces `fetch`, keeping every request it's given (its address and
 * options, as a `Request`).
 *
 * @param reply - What it answers each request with.
 * @returns The requests it was given.
 */
function stubFetch(reply: (request: Request) => Promise<Response> | Response): Request[] {
  const requests: Request[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return reply(request);
  });
  return requests;
}

/**
 * Starts a server on this computer that answers like Cloudflare R2 about an
 * upload's length: one sent without `Content-Length` (in chunks) is refused
 * with 411 Length Required, any other request succeeds.
 *
 * @returns Its address, the headers of each request it was sent, and a way to stop it.
 */
async function startLengthCheckingServer(): Promise<{
  endpoint: string;
  received: IncomingHttpHeaders[];
  stop: () => Promise<void>;
}> {
  const received: IncomingHttpHeaders[] = [];
  const server = createServer((request, response) => {
    received.push(request.headers);
    request.resume();
    request.on('end', () => {
      const unsized = request.method === 'PUT' && request.headers['content-length'] === undefined;
      response.writeHead(unsized ? 411 : 200).end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('The server has no port.');
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    received,
    /**
     * Stops the server, with the connections still open.
     *
     * @returns When it has stopped.
     */
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/**
 * Replaces `fetch` with one that acts as Next.js's does inside a request
 * (`doOriginalFetch` in `next/dist/server/lib/patch-fetch.js`): a `Request`
 * it's given is rebuilt around its body's stream, so the body's length is
 * lost and it's sent in chunks. Everything is then sent for real.
 */
function fetchAsNextJsDoes(): void {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!(input instanceof Request)) {
      return realFetch(input, init);
    }
    const rebuilt: RequestInit & { duplex: 'half' } = {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: input.signal,
      duplex: 'half',
    };
    return realFetch(new Request(input.url, rebuilt), init);
  });
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

  it('sends an upload with its length, even through a fetch that rebuilds requests as Next.js does', async () => {
    const server = await startLengthCheckingServer();
    fetchAsNextJsDoes();
    try {
      const storage = bucketStorage({ ...config, endpoint: server.endpoint, forcePathStyle: true });
      await storage.put(attachmentKey(ID), new TextEncoder().encode('printer log'), 'text/plain');

      expect(server.received).toHaveLength(1);
      expect(server.received[0]?.['content-length']).toBe('11');
      expect(server.received[0]?.['transfer-encoding']).toBeUndefined();
    } finally {
      await server.stop();
    }
  });

  it('tries a server error or 429 again twice, with the whole file, and a refusal never', async () => {
    const storage = bucketStorage(config, quick);
    /**
     * Uploads a one-byte file.
     *
     * @returns When it's stored.
     */
    const upload = () => storage.put(attachmentKey(ID), new Uint8Array([7]), 'image/png');

    const replies = [503, 429];
    const recovered = stubFetch(() => new Response(null, { status: replies.shift() ?? 200 }));
    await expect(upload()).resolves.toBeUndefined();
    expect(recovered).toHaveLength(3);
    const lastTry = defined(recovered[2], 'the last try');
    expect(new Uint8Array(await lastTry.arrayBuffer())).toEqual(new Uint8Array([7]));

    const failing = stubFetch(() => new Response(null, { status: 500 }));
    await expect(upload()).rejects.toMatchObject({ failure: 'failed' });
    expect(failing).toHaveLength(3);

    const refused = stubFetch(() => errorReply(400, 'InvalidRequest'));
    await expect(upload()).rejects.toMatchObject({ failure: 'failed' });
    expect(refused).toHaveLength(1);
  });

  it('tries a server error again even when its reply broke off', async () => {
    let tries = 0;
    stubFetch(() => {
      tries += 1;
      if (tries > 1) {
        return new Response(null, { status: 200 });
      }
      const brokenOff = new ReadableStream<Uint8Array>({
        /**
         * Ends the reply with an error before it sends anything.
         *
         * @param controller - The stream's controller.
         */
        start(controller) {
          controller.error(new TypeError('terminated'));
        },
      });
      return new Response(brokenOff, { status: 503 });
    });

    await expect(
      bucketStorage(config, quick).put(attachmentKey(ID), new Uint8Array([7]), 'image/png'),
    ).resolves.toBeUndefined();
    expect(tries).toBe(2);
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
