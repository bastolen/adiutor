/**
 * @file Tests for drawing a video's frame in the browser: a second in (or a
 * tenth of a short video, or its start when its length is unknown), fitted
 * inside 480 pixels as a JPEG; nothing for a video the browser can't decode
 * or that doesn't load in time; the video's address let go either way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import drawVideoFrame, { frameMoment } from './video-frame';

/** The hidden video the helper made, and the canvas it drew on. */
let video: HTMLVideoElement;
let canvas: HTMLCanvasElement;

/** What the canvas drew. */
const drawImage = vi.fn();

beforeEach(() => {
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = create(tag);
    if (element instanceof HTMLVideoElement) {
      video = element;
      // jsdom loads no media: the test plays the browser's part.
      Object.defineProperties(element, {
        videoWidth: { value: 1920 },
        videoHeight: { value: 1080 },
        duration: { value: 30, configurable: true },
        currentTime: { value: 0, writable: true },
        load: { value: vi.fn() },
      });
    }
    if (element instanceof HTMLCanvasElement) {
      canvas = element;
      Object.defineProperties(element, {
        getContext: {
          /**
           * A drawing context that records what's drawn.
           *
           * @returns The context.
           */
          value: () => ({ drawImage }),
        },
        toBlob: {
          /**
           * Hands over the drawing as a JPEG.
           *
           * @param done - Takes it.
           * @returns Nothing.
           */
          value: (done: (blob: Blob | null) => void) =>
            done(new Blob(['jpeg'], { type: 'image/jpeg' })),
        },
      });
    }
    return element;
  });
  URL.createObjectURL = vi.fn(() => 'blob:video');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  drawImage.mockReset();
});

describe('frameMoment', () => {
  it('takes a second in, a tenth of a short video, or the start of one without a length', () => {
    expect(frameMoment(30)).toBe(1);
    expect(frameMoment(5)).toBe(0.5);
    expect(frameMoment(Number.POSITIVE_INFINITY)).toBe(0);
    expect(frameMoment(Number.NaN)).toBe(0);
  });
});

describe('drawVideoFrame', () => {
  it('draws the frame a second in, fitted inside 480 pixels, and lets the video go', async () => {
    const drawing = drawVideoFrame(new Blob(['webm'], { type: 'video/webm' }));
    expect(video.muted).toBe(true);
    video.dispatchEvent(new Event('loadeddata'));
    expect(video.currentTime).toBe(1);
    video.dispatchEvent(new Event('seeked'));

    const frame = await drawing;
    expect(frame?.type).toBe('image/jpeg');
    expect([canvas.width, canvas.height]).toEqual([480, 270]);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 480, 270);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video');
  });

  it('gives nothing for a video the browser can’t decode', async () => {
    const drawing = drawVideoFrame(new Blob(['mov']));
    video.dispatchEvent(new Event('error'));
    expect(await drawing).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video');
  });

  it('gives nothing for a video that doesn’t load in time', async () => {
    vi.useFakeTimers();
    const drawing = drawVideoFrame(new Blob(['webm']));
    vi.advanceTimersByTime(10_000);
    expect(await drawing).toBeNull();
  });
});
