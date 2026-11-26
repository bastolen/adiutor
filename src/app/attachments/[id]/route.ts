/**
 * @file Attached files, served at `/attachments/<attachment ID>` (decision
 * 0044): streamed from the storage to whoever may read the text the file is
 * attached to (`loadAttachment`), always as a download under its name,
 * never kept by the browser. Behind the proxy like every page, which sends
 * someone signed out to sign in and back here, and gives these paths a
 * fixed policy that runs nothing (`FILE_POLICY`). Anything the reader may
 * not read, or that isn't there, is "not found".
 */
import type { NextRequest } from 'next/server';

import attachmentDisposition from '@/lib/request/content-disposition';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { loadAttachment } from '@/server/requests';
import { StorageError } from '@/server/storage';

/** What a browser keeps: nothing, so a shared computer keeps no file after sign-out. */
const NO_STORE = 'no-store';

/**
 * Serves a file as a download. The page's thumbnails load from here too: an
 * image element shows an image whatever its `Content-Disposition` says.
 *
 * @param _request - The request (unused).
 * @param context - The route's parameters: the attachment's ID.
 * @returns The file, `404` when there's none for this reader, or `503` when the storage fails.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext<'/attachments/[id]'>,
): Promise<Response> {
  // Sends someone whose session must be confirmed (or who needs MFA) where a page would.
  const actor = await getActor();
  let file;
  try {
    file = await loadAttachment(appContext, actor, (await context.params).id);
  } catch (error) {
    if (error instanceof StorageError) {
      // eslint-disable-next-line no-console -- The kind only: the storage's reply may say more.
      console.error('An attachment could not be read from the storage:', error.failure);
      return new Response(null, { status: 503, headers: { 'Cache-Control': NO_STORE } });
    }
    throw error;
  }
  if (!file) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': NO_STORE } });
  }
  return new Response(file.body, {
    headers: {
      'Content-Type': file.contentType,
      // So the browser shows how far a large download is.
      ...(file.size !== null && { 'Content-Length': String(file.size) }),
      'Content-Disposition': attachmentDisposition(file.name),
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': NO_STORE,
    },
  });
}
