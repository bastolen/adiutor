/**
 * @file Attached files, served at `/attachments/<attachment ID>` (decisions
 * 0044 and 0054): streamed from the storage to whoever may read the text the
 * file is attached to (`loadAttachment`), always as a download under its
 * name. The browser keeps a copy and asks before each use: the same checks
 * run every time, and a reader whose copy is the file gets `304 Not
 * Modified` without the storage being read. Behind the proxy like every
 * page, which sends someone signed out to sign in and back here, and gives
 * these paths a fixed policy that runs nothing (`FILE_POLICY`). Anything the
 * reader may not read, or that isn't there, is "not found".
 */
import type { NextRequest } from 'next/server';

import { entityTag, matchesIfNoneMatch } from '@/lib/request/conditional-get';
import attachmentDisposition from '@/lib/request/content-disposition';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { loadAttachment } from '@/server/requests';
import { StorageError } from '@/server/storage';

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
 * Serves a file as a download. The page's thumbnails load from here too: an
 * image element shows an image whatever its `Content-Disposition` says, and
 * the copy the thumbnail left makes downloading it a `304`.
 *
 * @param request - The request, with the browser's `If-None-Match` when it kept a copy.
 * @param context - The route's parameters: the attachment's ID.
 * @returns The file, `304` when the browser's copy is the file, `404` when there's none for this
 *   reader, or `503` when the storage fails.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<'/attachments/[id]'>,
): Promise<Response> {
  // Sends someone whose session must be confirmed (or who needs MFA) where a page would.
  const actor = await getActor();
  const notFound = new Response(null, { status: 404, headers: { 'Cache-Control': NO_STORE } });
  const { id } = await context.params;
  const file = await loadAttachment(appContext, actor, id);
  if (!file) {
    return notFound;
  }
  // A file's bytes, name and type never change (its key is made from its ID, and removing deletes
  // it), so its ID names this answer.
  const etag = entityTag(id);
  const kept = {
    ETag: etag,
    'Cache-Control': KEEP_CHECKED,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (matchesIfNoneMatch(request.headers.get('if-none-match'), etag)) {
    // The browser's copy is the file, and the reader may still read it: the storage isn't needed.
    return new Response(null, { status: 304, headers: kept });
  }
  let stored;
  try {
    stored = await file.readFile();
  } catch (error) {
    if (error instanceof StorageError) {
      // eslint-disable-next-line no-console -- The kind only: the storage's reply may say more.
      console.error('An attachment could not be read from the storage:', error.failure);
      return new Response(null, { status: 503, headers: { 'Cache-Control': NO_STORE } });
    }
    throw error;
  }
  if (!stored) {
    return notFound;
  }
  return new Response(stored.body, {
    headers: {
      'Content-Type': file.contentType,
      // So the browser shows how far a large download is.
      ...(stored.size !== null && { 'Content-Length': String(stored.size) }),
      'Content-Disposition': attachmentDisposition(file.name),
      ...kept,
    },
  });
}
