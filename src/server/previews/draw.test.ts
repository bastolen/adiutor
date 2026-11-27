/**
 * @file Tests for drawing a preview by its kind: an image drawn, a broken
 * one `none`, a PDF's first page, an Office file's thumbnail, which kinds
 * are drawn from the file, and `skipped` when every slot is taken or the
 * drawing library won't load, logged without the file.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawPreview, drawsFromFile } from './draw';
import drawImage from './draw-image';
import drawPdf from './draw-pdf';
import inDrawingSlot from './limiter';
import drawOfficeThumbnail from './office-thumbnail';

vi.mock('./draw-image', () => ({ default: vi.fn() }));
vi.mock('./draw-pdf', () => ({ default: vi.fn() }));
vi.mock('./office-thumbnail', () => ({ default: vi.fn() }));

afterEach(() => {
  vi.mocked(drawImage).mockReset();
  vi.mocked(drawPdf).mockReset();
  vi.mocked(drawOfficeThumbnail).mockReset();
});

/** A preview, as the drawing gives it. */
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

describe('drawPreview', () => {
  it('draws an image, or gives none for one it can’t draw', async () => {
    vi.mocked(drawImage).mockResolvedValueOnce(WEBP).mockResolvedValueOnce(null);
    const bytes = new Uint8Array([1, 2, 3]);

    expect(await drawPreview('image', bytes, 'skip')).toEqual({ status: 'drawn', webp: WEBP });
    expect(await drawPreview('image', bytes, 'skip')).toEqual({ status: 'none' });
    expect(drawImage).toHaveBeenCalledWith({ bytes });
  });

  it('draws a PDF’s first page', async () => {
    vi.mocked(drawPdf).mockResolvedValueOnce(WEBP);
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    expect(await drawPreview('pdf', bytes, 'wait')).toEqual({ status: 'drawn', webp: WEBP });
    expect(drawPdf).toHaveBeenCalledWith(bytes);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('draws the thumbnail an Office file carries', async () => {
    vi.mocked(drawOfficeThumbnail).mockResolvedValueOnce(WEBP);
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(await drawPreview('office', bytes, 'wait')).toEqual({ status: 'drawn', webp: WEBP });
    expect(drawOfficeThumbnail).toHaveBeenCalledWith(bytes);
  });

  it('skips a drawing that finds every slot taken', async () => {
    /** Ends the drawings that hold both slots. */
    let end = () => {};
    const holding = new Promise<void>((resolve) => {
      end = resolve;
    });
    const held = [inDrawingSlot(() => holding, 'skip'), inDrawingSlot(() => holding, 'skip')];

    expect(await drawPreview('image', new Uint8Array(), 'skip')).toEqual({ status: 'skipped' });
    expect(drawImage).not.toHaveBeenCalled();
    end();
    await Promise.all(held);
  });

  it('skips, and logs only the kind, when the drawing library won’t load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(drawImage).mockRejectedValue(new TypeError('Could not load the "sharp" module'));

    expect(await drawPreview('image', new Uint8Array(), 'wait')).toEqual({ status: 'skipped' });
    expect(error).toHaveBeenCalledWith('A preview could not be drawn:', 'image', 'TypeError');
    error.mockRestore();
  });
});

describe('drawsFromFile', () => {
  it('draws images, PDFs and Office files from the file, nothing for kinds without a preview', () => {
    expect(drawsFromFile('image')).toBe(true);
    expect(drawsFromFile('pdf')).toBe(true);
    expect(drawsFromFile('office')).toBe(true);
    expect(drawsFromFile('video')).toBe(false);
    expect(drawsFromFile(null)).toBe(false);
  });
});
