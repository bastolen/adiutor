/**
 * @file Tests for drawing an image's preview: PNG with its transparency, a
 * photo turned the way its camera says and without its metadata, a GIF's
 * first frame, WebP, a small image never enlarged; and `null` for anything
 * past a limit, broken, or not one of the four kinds by its signature.
 * @vitest-environment node
 */
import sharp, { type Color } from 'sharp';
import { describe, expect, it } from 'vitest';

import drawImage from './draw-image';

/**
 * A plain image, drawn with sharp.
 *
 * @param width - Its width.
 * @param height - Its height.
 * @param background - Its colour.
 * @returns A sharp image to encode.
 */
function plain(width: number, height: number, background: Color = '#336699') {
  return sharp({ create: { width, height, channels: 4, background } });
}

/**
 * What a preview is.
 *
 * @param webp - The preview.
 * @returns Its metadata.
 */
async function metadataOf(webp: Uint8Array | null) {
  if (!webp) {
    throw new Error('Expected a preview.');
  }
  return sharp(webp).metadata();
}

describe('drawImage', () => {
  it('draws a PNG as WebP fitted inside 480 pixels, keeping its transparency', async () => {
    const png = await plain(800, 600, { r: 0, g: 128, b: 0, alpha: 0.5 }).png().toBuffer();

    const meta = await metadataOf(await drawImage({ bytes: png }));

    expect(meta).toMatchObject({ format: 'webp', width: 480, height: 360, hasAlpha: true });
  });

  it('turns a photo the way its camera says, and leaves its metadata out', async () => {
    const jpeg = await plain(600, 400)
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'Adiutor Tests' } } })
      .toBuffer();

    const meta = await metadataOf(await drawImage({ bytes: jpeg }));

    expect(meta).toMatchObject({ width: 320, height: 480 });
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
  });

  it('draws only the first frame of an animated GIF, as a still', async () => {
    const red = await plain(40, 30, '#ff0000').png().toBuffer();
    const blue = await plain(40, 30, '#0000ff').png().toBuffer();
    const gif = await sharp([red, blue], { join: { animated: true } })
      .gif()
      .toBuffer();

    const webp = await drawImage({ bytes: gif });
    const meta = await metadataOf(webp);
    const { data } = await sharp(webp ?? new Uint8Array())
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(meta.pages ?? 1).toBe(1);
    expect(meta).toMatchObject({ width: 40, height: 30 });
    // Red, give or take what lossy WebP makes of it; the second frame is blue.
    const [r = 0, g = 0, b = 0] = data;
    expect(r).toBeGreaterThan(240);
    expect(g + b).toBeLessThan(20);
  });

  it('draws a WebP, and never enlarges a small image', async () => {
    const webp = await plain(100, 50).webp().toBuffer();
    expect(await metadataOf(await drawImage({ bytes: webp }))).toMatchObject({
      width: 100,
      height: 50,
    });
  });

  it('gives nothing for an image past the pixel limit', async () => {
    const png = await plain(100, 100).png().toBuffer();
    expect(await drawImage({ bytes: png, limits: { maxPixels: 9999, seconds: 5 } })).toBeNull();
  });

  it('gives nothing for a broken image', async () => {
    const png = await plain(800, 600).png().toBuffer();
    const jpeg = await plain(800, 600).jpeg().toBuffer();
    expect(await drawImage({ bytes: png.subarray(0, png.length / 2) })).toBeNull();
    expect(await drawImage({ bytes: jpeg.subarray(0, jpeg.length / 2) })).toBeNull();
  });

  it('never decodes what isn’t one of the four kinds by its signature', async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    );
    const tiff = await plain(10, 10).tiff().toBuffer();
    const html = new TextEncoder().encode('<!doctype html><title>Not an image</title>');
    for (const bytes of [svg, tiff, html]) {
      // eslint-disable-next-line no-await-in-loop -- One file at a time, each checked.
      expect(await drawImage({ bytes })).toBeNull();
    }
  });

  it('draws only the kinds it’s told the file may be', async () => {
    const gif = await plain(10, 10).gif().toBuffer();
    expect(await drawImage({ bytes: gif, checks: ['jpeg', 'png', 'webp'] })).toBeNull();
  });
});
