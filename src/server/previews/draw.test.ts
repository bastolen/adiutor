/**
 * @file Tests for drawing a preview by its kind: an image drawn, a broken
 * one `none`, which kinds are drawn from the file, and `skipped` when every
 * slot is taken or the drawing library won't load, logged without the file.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawPreview, drawsFromFile } from './draw';
import drawImage from './draw-image';
import inDrawingSlot from './limiter';

vi.mock('./draw-image', () => ({ default: vi.fn() }));

afterEach(() => {
  vi.mocked(drawImage).mockReset();
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
  it('draws images from the file, and nothing for kinds without a preview', () => {
    expect(drawsFromFile('image')).toBe(true);
    expect(drawsFromFile('video')).toBe(false);
    expect(drawsFromFile(null)).toBe(false);
  });
});
