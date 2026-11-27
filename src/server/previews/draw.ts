/**
 * @file Draws a file's preview by its kind (decision 0057): an image as it
 * is, a PDF's first page, the thumbnail an Office or OpenDocument file
 * carries, and for a video the frame its uploader's browser drew (a JPEG,
 * PNG or WebP image within `VIDEO_FRAME_LIMITS`), drawn again. A drawing
 * never throws for what's in a file: one it can't draw is `none`, and keeps
 * its icon. A drawing that can't start (every slot taken, or the drawing
 * library missing) is `skipped`, and left for the previews job.
 */
import type { AttachmentCheck, AttachmentPreviewKind } from '@/lib/requests';

import drawImage from './draw-image';
import drawPdf from './draw-pdf';
import inDrawingSlot, { BUSY } from './limiter';
import { VIDEO_FRAME_LIMITS } from './limits';
import drawOfficeThumbnail from './office-thumbnail';

/** The kinds of image a video's frame may be. */
const FRAME_CHECKS: readonly AttachmentCheck[] = ['jpeg', 'png', 'webp'];

/** What drawing a preview gave. */
export type PreviewDrawing =
  | {
      /** Drawn: the preview, as WebP. */
      status: 'drawn';
      /** The preview. */
      webp: Uint8Array<ArrayBuffer>;
    }
  | {
      /** It can't be drawn (broken, past a limit, nothing to draw): the icon. */
      status: 'none';
    }
  | {
      /** Not tried: every slot was taken, or the drawing library is missing. */
      status: 'skipped';
    };

/** A kind of preview drawn from the file itself: every kind but a video's. */
export type FilePreviewKind = Exclude<AttachmentPreviewKind, 'video'>;

/**
 * The kinds of preview drawn from the file itself, at upload and by the
 * previews job; a video's comes from the frame its uploader's browser drew.
 */
export const PREVIEWS_FROM_FILES: readonly FilePreviewKind[] = ['image', 'pdf', 'office'];

/**
 * Whether a kind of file's preview is drawn from the file itself.
 *
 * @param kind - The kind of preview its type has (`AttachmentType.preview`).
 * @returns Whether it is.
 */
export function drawsFromFile(kind: AttachmentPreviewKind | null): kind is FilePreviewKind {
  return kind !== null && (PREVIEWS_FROM_FILES as readonly string[]).includes(kind);
}

/**
 * Draws one preview, in its kind's way.
 *
 * @param kind - The kind of preview.
 * @param bytes - The file, or a video's frame.
 * @returns The preview, or `null` when it can't be drawn.
 */
async function drawByKind(
  kind: AttachmentPreviewKind,
  bytes: Uint8Array,
): Promise<Uint8Array<ArrayBuffer> | null> {
  switch (kind) {
    case 'image':
      return drawImage({ bytes });
    case 'pdf':
      return drawPdf(bytes);
    case 'office':
      return drawOfficeThumbnail(bytes);
    case 'video':
      return drawImage({ bytes, checks: FRAME_CHECKS, limits: VIDEO_FRAME_LIMITS });
    default:
      return null;
  }
}

/**
 * Draws a file's preview, in a slot of this server's few (`DRAWINGS_AT_ONCE`).
 *
 * @param kind - The kind of preview its type has.
 * @param bytes - The file.
 * @param whenBusy - With every slot taken: `skip` (an upload, which can't
 *   wait) or `wait` (the previews job).
 * @returns The preview, `none`, or `skipped`.
 */
export async function drawPreview(
  kind: AttachmentPreviewKind,
  bytes: Uint8Array,
  whenBusy: 'skip' | 'wait',
): Promise<PreviewDrawing> {
  try {
    const drawn = await inDrawingSlot(() => drawByKind(kind, bytes), whenBusy);
    if (drawn === BUSY) {
      return { status: 'skipped' };
    }
    return drawn ? { status: 'drawn', webp: drawn } : { status: 'none' };
  } catch (error) {
    // The library itself failed to load: no file is to blame, so none is marked.
    // eslint-disable-next-line no-console -- The kind and the error's name only: no file's content.
    console.error(
      'A preview could not be drawn:',
      kind,
      error instanceof Error ? error.name : 'failed',
    );
    return { status: 'skipped' };
  }
}
