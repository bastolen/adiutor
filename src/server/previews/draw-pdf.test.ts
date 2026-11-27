/**
 * @file Tests for drawing a PDF's first page: on white, as a WebP preview
 * fitted inside 480 pixels and a large page inside 1,600 for the viewer;
 * `null` for a PDF that needs a password, a broken one, one that needs more
 * memory than PDFium's cap, and one still drawing at its time limit (tried
 * again small, for its preview alone), whose worker is stopped and started
 * again for the next PDF.
 * @vitest-environment node
 */
import { Worker } from 'node:worker_threads';

import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { largeContentPdf, passwordPdf, simplePdf, slowPdf } from '../../../tests/files/pdfs';
import drawPdf from './draw-pdf';
import { PDF_LIMITS } from './limits';

describe('drawPdf', () => {
  it(
    'draws the first page on white, as a preview inside 480 pixels and large inside 1,600',
    { timeout: 20_000 },
    async () => {
      const drawn = await drawPdf(simplePdf());
      if (!drawn?.page) {
        throw new Error('Expected a preview and a page.');
      }
      expect(await sharp(drawn.page).metadata()).toMatchObject({
        format: 'webp',
        width: 1131,
        height: 1600,
      });
      const image = sharp(drawn.preview);
      expect(await image.metadata()).toMatchObject({ format: 'webp', width: 339, height: 480 });
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      /**
       * A pixel of the preview.
       *
       * @param x - Across, from the left.
       * @param y - Down, from the top.
       * @returns Its red, green and blue.
       */
      const pixel = (x: number, y: number) => {
        const at = (y * info.width + x) * info.channels;
        return [...data.subarray(at, at + 3)];
      };
      // The red block at the top of the page, and white below it.
      expect(pixel(10, 10)[0]).toBeGreaterThan(200);
      expect(pixel(10, 10)[1]).toBeLessThan(60);
      expect(pixel(10, 470)).toEqual([255, 255, 255]);
    },
  );

  it('draws a landscape page across', { timeout: 20_000 }, async () => {
    const drawn = await drawPdf(simplePdf('0 0 842 595'));
    expect(await sharp(drawn?.preview ?? new Uint8Array()).metadata()).toMatchObject({
      width: 480,
      height: 339,
    });
  });

  it(
    'gives nothing for a PDF that needs a password, or a broken one',
    { timeout: 20_000 },
    async () => {
      expect(await drawPdf(passwordPdf())).toBeNull();
      expect(await drawPdf(new TextEncoder().encode('%PDF-1.7 not really'))).toBeNull();
      expect(await drawPdf(simplePdf().subarray(0, 200))).toBeNull();
    },
  );

  it(
    'draws a PDF too heavy to draw large in time again, small, for its preview alone',
    { timeout: 20_000 },
    async () => {
      const posted = vi.spyOn(Worker.prototype, 'postMessage');
      try {
        expect(await drawPdf(slowPdf(), { ...PDF_LIMITS, seconds: 1 })).toBeNull();
        const sides = posted.mock.calls.map(([message]) => (message as { side: number }).side);
        expect(sides).toEqual([1600, 480]);
      } finally {
        posted.mockRestore();
      }
    },
  );

  it(
    'stops a PDF still drawing at its time limit, and draws the next',
    { timeout: 20_000 },
    async () => {
      const started = Date.now();
      expect(await drawPdf(slowPdf(), { ...PDF_LIMITS, seconds: 1 })).toBeNull();
      // Large, then small: two tries of a second each.
      expect(Date.now() - started).toBeLessThan(6000);

      expect(await drawPdf(simplePdf())).not.toBeNull();
    },
  );

  it(
    'gives nothing for a PDF that needs more memory than its cap, and draws the next',
    { timeout: 20_000 },
    async () => {
      // Its content unpacks to 64 MB: past a cap of 20 MiB, well within the usual 256 MiB.
      const large = largeContentPdf(64);
      const started = Date.now();
      expect(await drawPdf(large, { ...PDF_LIMITS, memoryPages: 320 })).toBeNull();
      expect(Date.now() - started).toBeLessThan(PDF_LIMITS.seconds * 1000);

      expect(await drawPdf(large)).not.toBeNull();
      expect(await drawPdf(simplePdf())).not.toBeNull();
    },
  );
});
