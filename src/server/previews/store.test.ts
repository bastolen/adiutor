/**
 * @file Tests for drawing a preview and keeping it: stored next to its file
 * and `drawn`, `none` for a file it can't draw, `skipped` when it wasn't
 * drawn, and `unstored` when the storage refuses it.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type FileStorage, pageKey, previewKey, StorageError } from '../storage';
import { drawPreview } from './draw';
import drawAndStorePreview from './store';

vi.mock('@/lib/env', () => ({ appUrl: 'https://adiutor.test', env: {} }));
vi.mock('./draw', () => ({ drawPreview: vi.fn() }));

/** An attachment's ID. */
const ID = '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a';

/** A preview, as the drawing gives it. */
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

/**
 * A storage whose `put` does what it's given.
 *
 * @param put - What storing does.
 * @returns The storage.
 */
function storageWith(put: FileStorage['put']): FileStorage {
  return { put } as FileStorage;
}

/** The file to draw. */
const input = {
  id: ID,
  kind: 'image' as const,
  bytes: new Uint8Array([1]),
  whenBusy: 'skip' as const,
};

afterEach(() => {
  vi.mocked(drawPreview).mockReset();
});

describe('drawAndStorePreview', () => {
  it('stores a drawn preview next to its file', async () => {
    vi.mocked(drawPreview).mockResolvedValue({ status: 'drawn', webp: WEBP, page: null });
    const put = vi.fn(async () => {});

    expect(await drawAndStorePreview(storageWith(put), input)).toBe('drawn');
    expect(put).toHaveBeenCalledExactlyOnceWith(previewKey(ID), WEBP, 'image/webp');
    expect(drawPreview).toHaveBeenCalledWith('image', input.bytes, 'skip');
  });

  it('stores a PDF’s large page too, and is drawn without it when the storage refuses it', async () => {
    const page = new Uint8Array([0x57, 0x45, 0x42, 0x50]);
    vi.mocked(drawPreview).mockResolvedValue({ status: 'drawn', webp: WEBP, page });
    const put = vi.fn(async () => {});
    expect(await drawAndStorePreview(storageWith(put), input)).toBe('drawn');
    expect(put).toHaveBeenCalledWith(pageKey(ID), page, 'image/webp');

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refusingPages = storageWith(async (key) => {
      if (key === pageKey(ID)) {
        throw new StorageError('timed_out');
      }
    });
    expect(await drawAndStorePreview(refusingPages, input)).toBe('drawn');
    expect(error).toHaveBeenCalledWith('A PDF’s large page could not be stored:', 'timed_out');
    error.mockRestore();
  });

  it('gives none for a file it can’t draw, and stores nothing', async () => {
    vi.mocked(drawPreview).mockResolvedValue({ status: 'none' });
    const put = vi.fn(async () => {});
    expect(await drawAndStorePreview(storageWith(put), input)).toBe('none');
    expect(put).not.toHaveBeenCalled();
  });

  it('leaves a skipped preview, or one the storage refused, for later', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(drawPreview).mockResolvedValueOnce({ status: 'skipped' });
    expect(await drawAndStorePreview(storageWith(vi.fn()), input)).toBe('skipped');

    vi.mocked(drawPreview).mockResolvedValueOnce({ status: 'drawn', webp: WEBP, page: null });
    const failing = storageWith(async () => {
      throw new StorageError('timed_out');
    });
    expect(await drawAndStorePreview(failing, input)).toBe('unstored');
    expect(error).toHaveBeenCalledWith('A preview could not be stored yet:', 'timed_out');
    error.mockRestore();
  });
});
