/**
 * @file Draws a file's preview and keeps it next to the file
 * (`previewKey`), giving where the preview then stands for its row.
 */
import type { AttachmentPreviewKind, AttachmentPreviewState } from '@/lib/requests';

import { type FileStorage, previewKey, StorageError } from '../storage';
import { drawPreview } from './draw';
import { PREVIEW_CONTENT_TYPE } from './limits';

/**
 * Draws a file's preview and stores it.
 *
 * @param storage - Where the file is kept.
 * @param input - The file.
 * @param input.id - Its attachment's ID.
 * @param input.kind - The kind of preview its type has, drawn from the file (`drawsFromFile`).
 * @param input.bytes - The file.
 * @param input.whenBusy - With every slot taken: `skip` or `wait`.
 * @returns `drawn` once it's stored, `none` when it can't be drawn, or `null`
 *   when it wasn't drawn or couldn't be stored (left for the previews job).
 */
export default async function drawAndStorePreview(
  storage: FileStorage,
  input: {
    id: string;
    kind: AttachmentPreviewKind;
    bytes: Uint8Array;
    whenBusy: 'skip' | 'wait';
  },
): Promise<AttachmentPreviewState | null> {
  const drawing = await drawPreview(input.kind, input.bytes, input.whenBusy);
  if (drawing.status === 'skipped') {
    return null;
  }
  if (drawing.status === 'none') {
    return 'none';
  }
  try {
    await storage.put(previewKey(input.id), drawing.webp, PREVIEW_CONTENT_TYPE);
    return 'drawn';
  } catch (error) {
    if (error instanceof StorageError) {
      // eslint-disable-next-line no-console -- The kind only: the storage's reply may say more.
      console.error('A preview could not be stored yet:', error.failure);
      return null;
    }
    throw error;
  }
}
