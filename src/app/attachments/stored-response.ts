/**
 * @file Answers a request for something kept in the attachments' storage (a
 * file, or its preview) to a reader the route has already checked
 * (decision 0054): always as a download, kept only by the reader's browser,
 * which asks before each use and gets `304 Not Modified` without the storage
 * being read. A file can also be read a part at a time (`Range`), as a video
 * that's played asks for it: `206` with the part, or `416` for a part past
 * its end. Anything that isn't there is "not found"; a storage that fails
 * is `503`, logged by its kind only.
 */
import { parseRange, type RangeRequest } from '@/lib/request/byte-range';
import { matchesIfNoneMatch } from '@/lib/request/conditional-get';
import attachmentDisposition from '@/lib/request/content-disposition';
import { StorageError, type StoredFile, type StoredPart } from '@/server/storage';

/**
 * What a browser keeps of a file: a copy of its own (never a shared cache's,
 * as who asks decides what's served), used only once the server says it's
 * still the reader's to read. Signing out asks the browser to drop it
 * (`clearCacheAtSignOut`).
 */
const KEEP_CHECKED = 'private, no-cache';

/** What a browser keeps of an answer that isn't the file: nothing. */
const NO_STORE = 'no-store';

/**
 * The answer for something the reader may not have, or that isn't there.
 *
 * @returns `404`, kept nowhere.
 */
export function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': NO_STORE } });
}

/** What to serve, once the reader is checked. */
export interface StoredToServe {
  /** The answer's entity tag (`entityTag`): what's served under it never changes. */
  etag: string;
  /** The type it's served as. */
  contentType: string;
  /** The name it's downloaded under. */
  filename: string;
  /**
   * Reads it from the storage.
   *
   * @returns It, or `null` when the storage has nothing under its key.
   * @throws {StorageError} When the storage fails.
   */
  read(): Promise<StoredFile | null>;
  /**
   * Reads a part of it from the storage, for something that may be read a
   * part at a time (a file, not its preview).
   *
   * @param range - The part.
   * @returns The part, or `null` when the storage has nothing under its key.
   * @throws {StorageError} When the storage fails.
   */
  readPart?(range: RangeRequest): Promise<StoredPart | null>;
}

/**
 * The answer for a storage that failed, told in the log by its kind only.
 *
 * @param error - What the storage threw.
 * @returns `503`, kept nowhere.
 * @throws {unknown} Anything that isn't a storage's failure.
 */
function unavailable(error: unknown): Response {
  if (error instanceof StorageError) {
    // eslint-disable-next-line no-console -- The kind only: the storage's reply may say more.
    console.error('An attachment could not be read from the storage:', error.failure);
    return new Response(null, { status: 503, headers: { 'Cache-Control': NO_STORE } });
  }
  throw error;
}

/**
 * Serves something from the storage as a download, or `304` when the
 * browser's copy is it.
 *
 * @param request - The request, with the browser's `If-None-Match` when it kept a copy.
 * @param stored - What to serve.
 * @returns The answer.
 */
export async function storedResponse(request: Request, stored: StoredToServe): Promise<Response> {
  const kept = {
    ETag: stored.etag,
    'Cache-Control': KEEP_CHECKED,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...(stored.readPart && { 'Accept-Ranges': 'bytes' }),
  };
  if (matchesIfNoneMatch(request.headers.get('if-none-match'), stored.etag)) {
    // The browser's copy is it, and the reader may still read it: the storage isn't needed.
    return new Response(null, { status: 304, headers: kept });
  }
  const range = parseRange(request.headers.get('range'));
  const ifRange = request.headers.get('if-range');
  // A part only of this very file: a copy from before (another tag, or a date) gets it whole.
  if (stored.readPart && range && (ifRange === null || ifRange === stored.etag)) {
    let part;
    try {
      part = await stored.readPart(range);
    } catch (error) {
      return unavailable(error);
    }
    if (!part) {
      return notFound();
    }
    if ('unsatisfiable' in part) {
      return new Response(null, {
        status: 416,
        headers: {
          ...(part.total !== null && { 'Content-Range': `bytes */${part.total}` }),
          ...kept,
        },
      });
    }
    return new Response(part.body, {
      status: 206,
      headers: {
        'Content-Type': stored.contentType,
        'Content-Length': String(part.end - part.start + 1),
        'Content-Range': `bytes ${part.start}-${part.end}/${part.total}`,
        'Content-Disposition': attachmentDisposition(stored.filename),
        ...kept,
      },
    });
  }
  let file;
  try {
    file = await stored.read();
  } catch (error) {
    return unavailable(error);
  }
  if (!file) {
    return notFound();
  }
  return new Response(file.body, {
    headers: {
      'Content-Type': stored.contentType,
      // So the browser shows how far a large download is.
      ...(file.size !== null && { 'Content-Length': String(file.size) }),
      'Content-Disposition': attachmentDisposition(stored.filename),
      ...kept,
    },
  });
}
