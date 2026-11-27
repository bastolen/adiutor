/**
 * @file A PDF's first page, drawn large for the viewer, served at
 * `/attachments/<attachment ID>/page`: to whoever may read the PDF
 * (`loadAttachment`), with the file's own checks and caching
 * (`storedResponse`), and a download if it's opened on its own. A file that
 * isn't a PDF with a preview, a PDF drawn before pages were, or one the
 * reader may not read is "not found"; the viewer then shows its preview.
 */
import type { NextRequest } from 'next/server';

import { entityTag } from '@/lib/request/conditional-get';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { PREVIEW_CONTENT_TYPE } from '@/server/previews';
import { loadAttachment } from '@/server/requests';

import { notFound, storedResponse } from '../../stored-response';

/** The type a PDF is stored as: only a PDF has a page. */
const PDF = 'application/pdf';

/**
 * The name a page is downloaded under: the PDF's, with `.webp` in place of
 * its extension.
 *
 * @param name - The PDF's name.
 * @returns The page's.
 */
function pageName(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.webp`;
}

/**
 * Serves a PDF's large first page.
 *
 * @param request - The request, with the browser's `If-None-Match` when it kept a copy.
 * @param context - The route's parameters: the attachment's ID.
 * @returns The page, `304` when the browser's copy is it, `404` when there's none for this
 *   reader, or `503` when the storage fails.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<'/attachments/[id]/page'>,
): Promise<Response> {
  const actor = await getActor();
  const { id } = await context.params;
  const file = await loadAttachment(appContext, actor, id);
  if (!file?.hasPreview || file.contentType !== PDF) {
    return notFound();
  }
  return storedResponse(request, {
    // A page is drawn once and never changes until it's deleted with its file.
    etag: entityTag(`${id}-page`),
    contentType: PREVIEW_CONTENT_TYPE,
    filename: pageName(file.name),
    read: file.readPage,
  });
}
