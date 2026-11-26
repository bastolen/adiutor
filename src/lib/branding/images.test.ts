/**
 * @file Tests for the brand images' rules: what a file's first bytes say it
 * is, which sizes and shapes a logo and an icon may have, and how an image
 * fits a box.
 */
import { describe, expect, it } from 'vitest';

import { brandImageProblem, fitInto, imageFacts, isAboutSquare } from './images';

/**
 * A big-endian number in bytes.
 *
 * @param value - The number.
 * @param length - How many bytes.
 * @returns Its bytes.
 */
function be(value: number, length: 2 | 4): number[] {
  return Array.from(
    { length },
    (_, index) => Math.floor(value / 256 ** (length - 1 - index)) % 256,
  );
}

/**
 * The start of a PNG: its signature and `IHDR` chunk.
 *
 * @param width - Its width.
 * @param height - Its height.
 * @returns The bytes.
 */
function pngStart(width: number, height: number): Uint8Array {
  return new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...be(13, 4),
    ...Array.from('IHDR', (letter) => letter.charCodeAt(0)),
    ...be(width, 4),
    ...be(height, 4),
    ...[8, 6, 0, 0, 0],
    ...[0, 0, 0, 0],
  ]);
}

/**
 * A JPEG segment with a length.
 *
 * @param marker - The byte after `FF`.
 * @param body - What follows the length.
 * @returns The bytes.
 */
function segment(marker: number, body: number[]): number[] {
  return [0xff, marker, ...be(body.length + 2, 2), ...body];
}

/**
 * A frame header (SOF) for a three-channel image.
 *
 * @param marker - Which SOF it is.
 * @param width - Its width.
 * @param height - Its height.
 * @returns The bytes.
 */
function frame(marker: number, width: number, height: number): number[] {
  return segment(marker, [
    8,
    ...be(height, 2),
    ...be(width, 2),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]);
}

/** A JFIF segment, which comes first in most JPEGs. */
const JFIF = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

describe('imageFacts', () => {
  it('reads a PNG’s size from its header', () => {
    expect(imageFacts(pngStart(280, 64))).toEqual({ type: 'png', width: 280, height: 64 });
  });

  it('reads a JPEG’s size from its first frame header, past other segments', () => {
    const bytes = new Uint8Array([
      0xff,
      0xd8,
      ...JFIF,
      ...segment(0xc4, [0, 1, 2]),
      ...frame(0xc0, 640, 160),
    ]);
    expect(imageFacts(bytes)).toEqual({ type: 'jpeg', width: 640, height: 160 });
  });

  it('reads a progressive JPEG, and skips fill bytes before a marker', () => {
    const bytes = new Uint8Array([0xff, 0xd8, ...JFIF, 0xff, ...frame(0xc2, 300, 300)]);
    expect(imageFacts(bytes)).toEqual({ type: 'jpeg', width: 300, height: 300 });
  });

  it('refuses a JPEG whose image data comes before any frame header', () => {
    const bytes = new Uint8Array([
      0xff,
      0xd8,
      ...JFIF,
      ...segment(0xda, [1, 2, 3]),
      ...frame(0xc0, 64, 64),
    ]);
    expect(imageFacts(bytes)).toBeNull();
  });

  it('refuses a JPEG without a height (one given after the image data)', () => {
    expect(imageFacts(new Uint8Array([0xff, 0xd8, ...JFIF, ...frame(0xc0, 64, 0)]))).toBeNull();
  });

  it('refuses files cut short', () => {
    expect(imageFacts(pngStart(280, 64).subarray(0, 20))).toBeNull();
    const jpeg = new Uint8Array([0xff, 0xd8, ...JFIF, ...frame(0xc0, 64, 64)]);
    expect(imageFacts(jpeg.subarray(0, jpeg.length - 14))).toBeNull();
    expect(imageFacts(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it('refuses other kinds of file, an SVG among them', () => {
    expect(
      imageFacts(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
    expect(imageFacts(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(imageFacts(new Uint8Array())).toBeNull();
  });

  it('refuses a PNG whose first chunk isn’t its header', () => {
    const bytes = pngStart(280, 64);
    bytes.set([0x49, 0x44, 0x41, 0x54], 12);
    expect(imageFacts(bytes)).toBeNull();
  });

  it('gives the size a file claims, however large, for the rules to refuse', () => {
    expect(imageFacts(pngStart(100_000, 100_000))).toEqual({
      type: 'png',
      width: 100_000,
      height: 100_000,
    });
  });
});

describe('brandImageProblem', () => {
  it('takes a wordmark, a square logo and a stacked one', () => {
    expect(brandImageProblem('logo', { width: 1000, height: 200 })).toBeNull();
    expect(brandImageProblem('logo', { width: 256, height: 256 })).toBeNull();
    expect(brandImageProblem('logo', { width: 100, height: 200 })).toBeNull();
  });

  it('refuses a logo too low, too wide or too tall', () => {
    expect(brandImageProblem('logo', { width: 200, height: 31 })).toBe('logoTooSmall');
    expect(brandImageProblem('logo', { width: 801, height: 100 })).toBe('logoShape');
    expect(brandImageProblem('logo', { width: 100, height: 201 })).toBe('logoShape');
  });

  it('takes an icon about square, and refuses one too small or too long', () => {
    expect(brandImageProblem('icon', { width: 48, height: 64 })).toBeNull();
    expect(brandImageProblem('icon', { width: 31, height: 31 })).toBe('iconTooSmall');
    expect(brandImageProblem('icon', { width: 100, height: 151 })).toBe('iconShape');
  });

  it('refuses any image more than 4096 pixels wide or high', () => {
    expect(brandImageProblem('logo', { width: 4097, height: 1024 })).toBe('tooManyPixels');
    expect(brandImageProblem('icon', { width: 4096, height: 4097 })).toBe('tooManyPixels');
  });
});

describe('isAboutSquare', () => {
  it('counts a longer side of up to one and a half times the shorter', () => {
    expect(isAboutSquare({ width: 150, height: 100 })).toBe(true);
    expect(isAboutSquare({ width: 100, height: 150 })).toBe(true);
    expect(isAboutSquare({ width: 151, height: 100 })).toBe(false);
  });
});

describe('fitInto', () => {
  it('shrinks an image to its box, keeping its shape', () => {
    expect(fitInto({ width: 2048, height: 256 }, { width: 1024, height: 256 })).toEqual({
      width: 1024,
      height: 128,
    });
    expect(fitInto({ width: 600, height: 1200 }, { width: 1024, height: 256 })).toEqual({
      width: 128,
      height: 256,
    });
  });

  it('never enlarges an image', () => {
    expect(fitInto({ width: 280, height: 64 }, { width: 1024, height: 256 })).toEqual({
      width: 280,
      height: 64,
    });
  });

  it('keeps at least one pixel on each side', () => {
    expect(fitInto({ width: 4096, height: 1 }, { width: 512, height: 512 })).toEqual({
      width: 512,
      height: 1,
    });
  });
});
