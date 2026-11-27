/**
 * @file Draws a file's preview and keeps it next to the file
 * (`previewKey`), with a PDF's large first page (`pageKey`), saying how that
 * went: drawn and stored, impossible to draw, not tried (`skipped`), or
 * drawn but not stored (`unstored`).
 */
import type { AttachmentPreviewKind } from '@/lib/requests';

import { type FileStorage, pageKey, previewKey, StorageError } from '../storage';
import { drawPreview } from './draw';
import { PREVIEW_CONTENT_TYPE } from './limits';

/**
 * How drawing and storing a preview went: `drawn` (stored under
 * `previewKey`), `none` (it can't be drawn: the icon), `skipped` (every slot
 * was taken, or the drawing library won't load) or `unstored` (the storage
 * refused it). Only `drawn` and `none` are final.
 */
export type PreviewOutcome = 'drawn' | 'none' | 'skipped' | 'unstored';

/**
 * Draws a file's preview and stores it.
 *
 * @param storage - Where the file is kept.
 * @param input - The file.
 * @param input.id - Its attachment's ID.
 * @param input.kind - The kind of preview its type has.
 * @param input.bytes - The file (or, for a video, the frame its uploader's browser drew).
 * @param input.whenBusy - With every slot taken: `skip` or `wait`.
 * @returns How it went.
 */
export default async function drawAndStorePreview(
  storage: FileStorage,
  input: {
    id: string;
    kind: AttachmentPreviewKind;
    bytes: Uint8Array;
    whenBusy: 'skip' | 'wait';
  },
): Promise<PreviewOutcome> {
  const drawing = await drawPreview(input.kind, input.bytes, input.whenBusy);
  if (drawing.status !== 'drawn') {
    return drawing.status;
  }
  try {
    await storage.put(previewKey(input.id), drawing.webp, PREVIEW_CONTENT_TYPE);
  } catch (error) {
    if (error instanceof StorageError) {
      // eslint-disable-next-line no-console -- The kind only: the storage's reply may say more.
      console.error('A preview could not be stored yet:', error.failure);
      return 'unstored';
    }
    throw error;
  }
  if (!drawing.page) {
    return 'drawn';
  }
  // The large page only adds to the preview: without it, the viewer shows the preview.
  try {
    await storage.put(pageKey(input.id), drawing.page, PREVIEW_CONTENT_TYPE);
  } catch (error) {
    if (error instanceof StorageError) {
      // eslint-disable-next-line no-console -- The kind only: the storage's reply may say more.
      console.error('A PDF’s large page could not be stored:', error.failure);
      return 'drawn';
    }
    throw error;
  }
  return 'drawn';
}
