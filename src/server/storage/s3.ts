/**
 * @file The S3-compatible driver: files in a bucket, at their key, on AWS
 * S3, Cloudflare R2, Backblaze B2 or a server of your own (Garage,
 * SeaweedFS). Requests are signed with `aws4fetch`'s signer (AWS Signature
 * V4) rather than the AWS SDK, and sent with `fetch`, given the address and
 * options, never a `Request` (see `signedFetch`). Every upload is signed with
 * its SHA-256, so the service refuses one that arrives changed. What a
 * service replies is only read for its error code, and never logged or
 * shown.
 */
import { createHash } from 'node:crypto';

import { AwsV4Signer } from 'aws4fetch';

import { rangeHeader, resolveRange } from '@/lib/request/byte-range';
import type { S3StorageConfig } from '@/lib/storage';

import { StorageError, storageErrorOf } from './errors';
import withIdleLimit from './idle-limit';
import { assertStorageKey } from './keys';
import sliceStream from './slice';
import type { FileStorage } from './types';

/** The time limits, in milliseconds. */
export interface BucketTimeouts {
  /** For an upload, which sends the whole file. */
  put: number;
  /** For the answer to a read, until its first byte. */
  firstByte: number;
  /** For each next piece of a file that's being read. */
  idle: number;
  /** For a delete. */
  delete: number;
  /**
   * The longest wait before trying a server error or 429 again; each next
   * wait may be twice as long, the wait itself chosen at random up to it.
   */
  retry: number;
}

/** The time limits a server uses. */
const TIMEOUTS: BucketTimeouts = {
  put: 120_000,
  firstByte: 15_000,
  idle: 30_000,
  delete: 15_000,
  retry: 200,
};

/** How often a server error or 429 is tried again: twice, as a request handler can't wait longer. */
const RETRIES = 2;

/** A request to the bucket, as `signedFetch` sends it. */
interface BucketRequest {
  /** Its method. */
  method: 'GET' | 'PUT' | 'DELETE';
  /** Headers to sign and send, besides the date and the signature. */
  headers?: Record<string, string>;
  /** The file, for an upload. */
  body?: Uint8Array<ArrayBuffer>;
  /** Ends the request, every try of it together. */
  signal: AbortSignal;
}

/**
 * Waits.
 *
 * @param ms - For how long, in milliseconds.
 */
async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** How much of an error reply is read for its code. */
const ERROR_READ_BYTES = 2048;

/** How long an error reply's first bytes may take, in milliseconds. */
const ERROR_READ_MS = 5_000;

/**
 * Reads an S3 error reply's code (`NoSuchKey`, `NoSuchBucket`, ...), from
 * its first bytes only, and for a few seconds at most: the rest of the reply
 * is never read, however large or slow it is.
 *
 * @param response - The reply.
 * @returns The code, or `null` without one.
 */
async function errorCode(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const decoder = new TextDecoder();
  let text = '';
  const timer = setTimeout(() => {
    reader.cancel().catch(() => {});
  }, ERROR_READ_MS);
  try {
    while (text.length < ERROR_READ_BYTES) {
      // One piece after another, until there's enough or the reply ends (or is cancelled).
      // eslint-disable-next-line no-await-in-loop -- a stream is read a piece at a time
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // A reply that broke off: what arrived is all there is.
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }
  return /<Code>([A-Za-z]+)<\/Code>/.exec(text.slice(0, ERROR_READ_BYTES))?.[1] ?? null;
}

/**
 * The storage error for a reply that isn't a success.
 *
 * @param response - The reply.
 * @returns The storage error.
 */
async function replyError(response: Response): Promise<StorageError> {
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    return new StorageError('refused');
  }
  if (response.status === 404 && (await errorCode(response)) === 'NoSuchBucket') {
    return new StorageError('not_found');
  }
  return new StorageError('failed');
}

/**
 * Runs a request, turning what it throws into a storage error: a time limit
 * that ran out is `timed_out`, anything else (no connection) `unreachable`.
 *
 * @param request - The request.
 * @returns Its reply.
 */
async function send(request: Promise<Response>): Promise<Response> {
  try {
    return await request;
  } catch (error) {
    throw storageErrorOf(error, 'unreachable');
  }
}

/**
 * The file's size a `Content-Range` header names, after its slash (`bytes 0-9/1234`).
 *
 * @param header - The header.
 * @returns The size, or `null` when it names none.
 */
function totalOf(header: string | null): number | null {
  const match = /\/(\d+)$/.exec(header ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * A storage in an S3-compatible bucket.
 *
 * @param config - The bucket's settings.
 * @param timeouts - The time limits; the tests shorten them.
 * @returns The storage.
 */
export default function bucketStorage(
  config: S3StorageConfig,
  timeouts: BucketTimeouts = TIMEOUTS,
): FileStorage {
  /** The signing keys made so far (one a day), kept for the next requests. */
  const signingKeys = new Map<string, ArrayBuffer>();

  /**
   * Signs a request and sends it, trying a server error or 429 again
   * (`RETRIES`), each try signed anew. `fetch` is given the address and the
   * options, never a `Request`: inside a request, Next.js's `fetch` rebuilds
   * a `Request` around its body's stream, which loses the body's length, so
   * an upload went out in chunks, and Cloudflare R2 refuses an upload without
   * `Content-Length` (411 Length Required). Given the bytes themselves,
   * `fetch` sends their length.
   *
   * @param url - The address.
   * @param request - The request.
   * @param attempt - How many tries came before this one.
   * @returns The reply to the last try.
   */
  const signedFetch = async (
    url: string,
    request: BucketRequest,
    attempt = 0,
  ): Promise<Response> => {
    const signed = await new AwsV4Signer({
      url,
      method: request.method,
      headers: request.headers,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
      region: config.region,
      cache: signingKeys,
    }).sign();
    const response = await fetch(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: request.body,
      signal: request.signal,
    });
    if (attempt >= RETRIES || (response.status < 500 && response.status !== 429)) {
      return response;
    }
    // A reply that already broke off can't be cancelled, and is tried again all the same.
    await response.body?.cancel().catch(() => {});
    await wait(Math.random() * timeouts.retry * 2 ** attempt);
    return signedFetch(url, request, attempt + 1);
  };

  const endpoint = new URL(config.endpoint);
  const basePath = endpoint.pathname.replace(/\/+$/, '');

  /**
   * A file's address in the bucket, for a key this module made.
   *
   * @param key - The key.
   * @returns Its address.
   */
  const urlOf = (key: string) => {
    assertStorageKey(key);
    const url = new URL(endpoint);
    if (config.forcePathStyle) {
      url.pathname = `${basePath}/${encodeURIComponent(config.bucket)}/${key}`;
    } else {
      url.hostname = `${config.bucket}.${endpoint.hostname}`;
      url.pathname = `${basePath}/${key}`;
    }
    return url.toString();
  };

  const storage: FileStorage = {
    driver: 's3',

    /**
     * Uploads a file, signed with its SHA-256 and sent with its length.
     *
     * @param key - Where.
     * @param bytes - The file.
     * @param contentType - Its type, which the bucket keeps.
     */
    async put(key, bytes, contentType) {
      const response = await send(
        signedFetch(urlOf(key), {
          method: 'PUT',
          body: bytes,
          headers: {
            'Content-Type': contentType,
            'X-Amz-Content-Sha256': createHash('sha256').update(bytes).digest('hex'),
          },
          signal: AbortSignal.timeout(timeouts.put),
        }),
      );
      if (!response.ok) {
        throw await replyError(response);
      }
      await response.body?.cancel();
    },

    /**
     * Reads a file: the wait for the reply has a time limit, and so does
     * each next piece of the file.
     *
     * @param key - Where.
     * @returns The file and its size, or `null` when it isn't there.
     */
    async get(key) {
      // Only the wait for the reply has this limit; the file's bytes have an idle limit instead.
      const answered = new AbortController();
      const timer = setTimeout(
        () => answered.abort(new StorageError('timed_out')),
        timeouts.firstByte,
      );
      let response: Response;
      try {
        response = await send(signedFetch(urlOf(key), { method: 'GET', signal: answered.signal }));
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 404) {
        const code = await errorCode(response);
        if (code === 'NoSuchBucket') {
          throw new StorageError('not_found');
        }
        return null;
      }
      if (!response.ok || !response.body) {
        throw await replyError(response);
      }
      const length = Number(response.headers.get('content-length'));
      return {
        body: withIdleLimit(response.body, timeouts.idle),
        size: Number.isSafeInteger(length) && length >= 0 ? length : null,
      };
    },

    /**
     * Reads a part of a file, as the bucket's server reads the range itself;
     * from a server that sends the whole file instead, the part is cut out.
     *
     * @param key - Where.
     * @param range - The part.
     * @returns The part, or `null` when the file isn't there.
     */
    async getPart(key, range) {
      const answered = new AbortController();
      const timer = setTimeout(
        () => answered.abort(new StorageError('timed_out')),
        timeouts.firstByte,
      );
      let response: Response;
      try {
        response = await send(
          signedFetch(urlOf(key), {
            method: 'GET',
            headers: { Range: rangeHeader(range) },
            signal: answered.signal,
          }),
        );
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 404) {
        const code = await errorCode(response);
        if (code === 'NoSuchBucket') {
          throw new StorageError('not_found');
        }
        return null;
      }
      if (response.status === 416) {
        await response.body?.cancel();
        return { unsatisfiable: true, total: totalOf(response.headers.get('content-range')) };
      }
      if (!response.ok || !response.body) {
        throw await replyError(response);
      }
      const body = withIdleLimit(response.body, timeouts.idle);
      if (response.status === 206) {
        // Only a part that's whole numbers, in order and inside the file is taken as one.
        const [, start = NaN, end = NaN, total = NaN] = (
          /^bytes (\d{1,15})-(\d{1,15})\/(\d{1,15})$/.exec(
            response.headers.get('content-range') ?? '',
          ) ?? []
        ).map(Number);
        if (start <= end && end < total) {
          return { body, start, end, total };
        }
        await body.cancel();
        throw new StorageError('failed');
      }
      // A server that ignored the range sends the whole file, as a 200: the part is cut from it.
      const length = Number(response.headers.get('content-length'));
      if (response.status !== 200 || !Number.isSafeInteger(length) || length <= 0) {
        await body.cancel();
        throw new StorageError('failed');
      }
      const part = resolveRange(range, length);
      if (!part) {
        await body.cancel();
        return { unsatisfiable: true, total: length };
      }
      return { body: sliceStream(body, part.start, part.end), ...part, total: length };
    },

    /**
     * Deletes a file; one that isn't there counts as deleted.
     *
     * @param key - Where.
     */
    async delete(key) {
      const response = await send(
        signedFetch(urlOf(key), {
          method: 'DELETE',
          signal: AbortSignal.timeout(timeouts.delete),
        }),
      );
      if (response.ok) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 404) {
        if ((await errorCode(response)) === 'NoSuchBucket') {
          throw new StorageError('not_found');
        }
        return;
      }
      throw await replyError(response);
    },

    /** Needs nothing: a bucket is never a folder a missing volume leaves behind. */
    setUp: async () => {},

    /**
     * Always set up: see `setUp`.
     *
     * @returns `true`.
     */
    isSetUp: async () => true,

    /**
     * Runs the calls; every request signs in on its own.
     *
     * @param work - The calls.
     * @returns What they return.
     */
    session: (work) => work(storage),
  };
  return storage;
}
