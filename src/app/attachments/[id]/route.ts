/**
 * @file Attached files, served at `/attachments/<attachment ID>` (decisions
 * 0044 and 0054): streamed from the storage to whoever may read the text the
 * file is attached to (`loadAttachment`), always as a download under its
 * name. The browser keeps a copy and asks before each use: the same checks
 * run every time, and a reader whose copy is the file gets `304 Not
 * Modified` without the storage being read (`storedResponse`). Behind the
 * proxy like every page, which sends someone signed out to sign in and back
 * here, and gives these paths a fixed policy that runs nothing
 * (`FILE_POLICY`). Anything the reader may not read, or that isn't there, is
 * "not found". The tiles show a file's preview (`preview/route.ts`), never
 * the file itself.
 */
import type { NextRequest } from 'next/server';

import { entityTag } from '@/lib/request/conditional-get';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { loadAttachment } from '@/server/requests';

import { notFound, storedResponse } from '../stored-response';

/**
 * Serves a file as a download.
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
  const { id } = await context.params;
  const file = await loadAttachment(appContext, actor, id);
  if (!file) {
    return notFound();
  }
  return storedResponse(request, {
    // A file's bytes, name and type never change (its key is made from its ID, and removing
    // deletes it), so its ID names this answer.
    etag: entityTag(id),
    contentType: file.contentType,
    filename: file.name,
    read: file.readFile,
  });
}
