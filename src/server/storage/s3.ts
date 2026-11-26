/**
 * @file The S3-compatible driver: files in a bucket, at their key, on AWS
 * S3, Cloudflare R2, Backblaze B2 or a server of your own (Garage,
 * SeaweedFS). Requests are signed with `aws4fetch` (AWS Signature V4), a
 * small signer on top of `fetch`, rather than the AWS SDK. Every upload is
 * signed with its SHA-256, so the service refuses one that arrives changed.
 * What a service replies is only read for its error code, and never logged
 * or shown.
 */
import { createHash } from 'node:crypto';

import { AwsClient } from 'aws4fetch';

import type { S3StorageConfig } from '@/lib/storage';

import { StorageError, storageErrorOf } from './errors';
import withIdleLimit from './idle-limit';
import { assertStorageKey } from './keys';
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
}

/** The time limits a server uses. */
const TIMEOUTS: BucketTimeouts = {
  put: 120_000,
  firstByte: 15_000,
  idle: 30_000,
  delete: 15_000,
};

/** How much of an error reply is read for its code. */
const ERROR_READ_BYTES = 2048;

/**
 * Reads an S3 error reply's code (`NoSuchKey`, `NoSuchBucket`, ...), from
 * its first bytes only.
 *
 * @param response - The reply.
 * @returns The code, or `null` without one.
 */
async function errorCode(response: Response): Promise<string | null> {
  try {
    const text = (await response.text()).slice(0, ERROR_READ_BYTES);
    return /<Code>([A-Za-z]+)<\/Code>/.exec(text)?.[1] ?? null;
  } catch {
    return null;
  }
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
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region,
    // A server error or 429 is tried again twice; a request handler can't wait longer.
    retries: 2,
    initRetryMs: 200,
  });
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
     * Uploads a file, signed with its SHA-256.
     *
     * @param key - Where.
     * @param bytes - The file.
     * @param contentType - Its type, which the bucket keeps.
     */
    async put(key, bytes, contentType) {
      const response = await send(
        client.fetch(urlOf(key), {
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
        response = await send(client.fetch(urlOf(key), { signal: answered.signal }));
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
     * Deletes a file; one that isn't there counts as deleted.
     *
     * @param key - Where.
     */
    async delete(key) {
      const response = await send(
        client.fetch(urlOf(key), {
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
