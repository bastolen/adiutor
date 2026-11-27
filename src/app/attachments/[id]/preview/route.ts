/**
 * @file A file's preview, served at `/attachments/<attachment ID>/preview`
 * (decision 0057): the small WebP image its tile shows, to whoever may read
 * the file (`loadAttachment`), with the file's own checks and caching
 * (`storedResponse`): kept only by the reader's browser, asked about before
 * each use, and a download like the file if it's ever opened on its own. A
 * file without a preview, or one the reader may not read, is "not found".
 */
import type { NextRequest } from 'next/server';

import { entityTag } from '@/lib/request/conditional-get';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { PREVIEW_CONTENT_TYPE } from '@/server/previews';
import { loadAttachment } from '@/server/requests';

import { notFound, storedResponse } from '../../stored-response';

/**
 * The name a preview is downloaded under: the file's, with `.webp` in place
 * of its extension.
 *
 * @param name - The file's name.
 * @returns The preview's.
 */
function previewName(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.webp`;
}

/**
 * Serves a file's preview.
 *
 * @param request - The request, with the browser's `If-None-Match` when it kept a copy.
 * @param context - The route's parameters: the attachment's ID.
 * @returns The preview, `304` when the browser's copy is it, `404` when there's none for this
 *   reader, or `503` when the storage fails.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<'/attachments/[id]/preview'>,
): Promise<Response> {
  const actor = await getActor();
  const { id } = await context.params;
  const file = await loadAttachment(appContext, actor, id);
  if (!file?.hasPreview) {
    return notFound();
  }
  return storedResponse(request, {
    // A preview is drawn once and never changes until it's deleted with its file.
    etag: entityTag(`${id}-preview`),
    contentType: PREVIEW_CONTENT_TYPE,
    filename: previewName(file.name),
    read: file.readPreview,
  });
}
