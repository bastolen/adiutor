/**
 * @file Drawing the brand's images as PNGs (decision 0052), with the
 * `ImageResponse` Next.js ships (Satori and Resvg; no image library of its
 * own). An uploaded logo or icon is drawn again before it's stored, so
 * Adiutor only ever serves a PNG it made itself: whatever else the file held
 * (a JPEG's location, a PNG's text) stays behind, and mail clients get a
 * PNG.
 */
import { inflateSync } from 'node:zlib';

import { ImageResponse } from 'next/og';
import type { ReactElement } from 'react';

import { fitInto, IMAGE_CONTENT_TYPES, type ImageFacts, type ImageSize } from '@/lib/branding';

/** A drawn PNG and its size. */
export interface DrawnImage extends ImageSize {
  /** The PNG's bytes. */
  content: Uint8Array;
}

/**
 * Draws an element as a PNG.
 *
 * @param element - What to draw, in the CSS `ImageResponse` knows (flexbox).
 * @param size - The PNG's size.
 * @returns The PNG's bytes.
 */
export async function drawPng(element: ReactElement, size: ImageSize): Promise<Uint8Array> {
  const response = new ImageResponse(element, size);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * A `data:` address holding an image, for an `<img>` in what's drawn.
 *
 * @param bytes - The image.
 * @param type - Its kind.
 * @returns The address.
 */
export function imageDataUrl(bytes: Uint8Array, type: ImageFacts['type']): string {
  return `data:${IMAGE_CONTENT_TYPES[type]};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * Whether a PNG that Resvg drew is empty, every pixel transparent black:
 * what it draws for an image it couldn't decode. A row of all-zero pixels
 * filters to all-zero bytes whatever its filter, and the other way round,
 * so the inflated rows show it without decoding the filters. A PNG that
 * isn't 8-bit RGBA, as Resvg writes them, never counts as empty.
 *
 * @param png - The PNG.
 * @returns Whether nothing shows in it.
 */
export function isBlankPng(png: Uint8Array): boolean {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  const data: Uint8Array[] = [];
  for (let at = 8; at + 8 <= png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      const [bitDepth, colourType] = [body[8], body[9]];
      if (bitDepth !== 8 || colourType !== 6) {
        return false;
      }
      width = view.getUint32(at + 8);
    } else if (type === 'IDAT') {
      data.push(body);
    }
    at += 12 + length;
  }
  if (width === 0 || data.length === 0) {
    return false;
  }
  const rows = inflateSync(Buffer.concat(data));
  const stride = 1 + width * 4;
  // Skip each row's filter byte.
  return rows.every((byte, index) => byte === 0 || index % stride === 0);
}

/**
 * Draws an uploaded image again as a PNG that fits a box, keeping its shape
 * and never enlarging it, on a transparent background.
 *
 * @param bytes - The uploaded file.
 * @param facts - What its header says it is (`imageFacts`).
 * @param box - The room it may take.
 * @returns The new PNG and its size, or `null` when the image didn't decode
 *   (nothing showed).
 */
export async function redrawImage(
  bytes: Uint8Array,
  facts: ImageFacts,
  box: ImageSize,
): Promise<DrawnImage | null> {
  const size = fitInto(facts, box);
  const content = await drawPng(
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Drawn into a PNG by ImageResponse, never shown in a page. */}
      <img src={imageDataUrl(bytes, facts.type)} width={size.width} height={size.height} alt="" />
    </div>,
    size,
  );
  return isBlankPng(content) ? null : { content, ...size };
}
