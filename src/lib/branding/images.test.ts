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

/** The start of the image data, some image data with a stuffed `FF`, and the end of the image. */
const SCAN = [...segment(0xda, [1, 1, 0, 0, 0x3f, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd9];

/**
 * A JPEG of the given parts, between its start marker and its image data.
 *
 * @param parts - The segments before the image data.
 * @returns The bytes.
 */
function jpeg(...parts: number[][]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...parts.flat(), ...SCAN]);
}

describe('imageFacts', () => {
  it('reads a PNG’s size from its header', () => {
    expect(imageFacts(pngStart(280, 64))).toEqual({ type: 'png', width: 280, height: 64 });
  });

  it('reads a JPEG’s size from its frame header, past the segments every decoder skips', () => {
    const tables = [...segment(0xdb, [0, 1, 2]), ...segment(0xc4, [0, 1, 2])];
    expect(imageFacts(jpeg(JFIF, tables, frame(0xc0, 640, 160)))).toEqual({
      type: 'jpeg',
      width: 640,
      height: 160,
    });
  });

  it('reads a progressive JPEG, and skips fill bytes before a marker', () => {
    expect(imageFacts(jpeg(JFIF, [0xff], frame(0xc2, 300, 300)))).toEqual({
      type: 'jpeg',
      width: 300,
      height: 300,
    });
  });

  it('reads past an Exif thumbnail, itself a JPEG, and ignores pictures after the end', () => {
    const thumbnail = [0xff, 0xd8, ...frame(0xc0, 8000, 8000), 0xff, 0xd9];
    const exif = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...thumbnail]);
    const appended = [0xff, 0xd8, ...frame(0xc0, 9000, 9000), ...SCAN];
    const bytes = new Uint8Array([...jpeg(exif, frame(0xc0, 64, 64)), ...appended]);
    expect(imageFacts(bytes)).toEqual({ type: 'jpeg', width: 64, height: 64 });
  });

  it('refuses a JPEG whose image data comes before any frame header', () => {
    const bytes = new Uint8Array([0xff, 0xd8, ...JFIF, ...SCAN, ...frame(0xc0, 64, 64)]);
    expect(imageFacts(bytes)).toBeNull();
  });

  it('refuses a JPEG without a height (one given after the image data)', () => {
    expect(imageFacts(jpeg(JFIF, frame(0xc0, 64, 0)))).toBeNull();
  });

  it('refuses a small frame header that decoders skip, before the large one they read', () => {
    // `FF 00` is stuffing to decoders, which then never see the fake frame in the APP15 segment.
    const fake = [...frame(0xc0, 64, 64)];
    expect(
      imageFacts(jpeg([0xff, 0x00, 0x00, 0x06], segment(0xef, fake), frame(0xc0, 12000, 12000))),
    ).toBeNull();
  });

  it('refuses a second frame header, before or in the image data', () => {
    expect(imageFacts(jpeg(frame(0xc0, 64, 64), frame(0xc2, 12000, 12000)))).toBeNull();
    const later = new Uint8Array([
      0xff,
      0xd8,
      ...frame(0xc0, 64, 64),
      ...segment(0xda, [1]),
      0x12,
      ...frame(0xc0, 12000, 12000),
      0xff,
      0xd9,
    ]);
    expect(imageFacts(later)).toBeNull();
  });

  it('refuses reserved markers and the kinds of frame it doesn’t take', () => {
    expect(imageFacts(jpeg(segment(0x02, [0, 0]), frame(0xc0, 64, 64)))).toBeNull();
    expect(imageFacts(jpeg(frame(0xc3, 64, 64)))).toBeNull();
    expect(imageFacts(jpeg(frame(0xc9, 64, 64)))).toBeNull();
  });

  it('refuses files cut short', () => {
    expect(imageFacts(pngStart(280, 64).subarray(0, 20))).toBeNull();
    const whole = jpeg(JFIF, frame(0xc0, 64, 64));
    expect(imageFacts(whole.subarray(0, 2 + JFIF.length + 5))).toBeNull();
    expect(imageFacts(whole.subarray(0, whole.length - SCAN.length))).toBeNull();
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

  it('grows an image to fill its box when asked', () => {
    expect(fitInto({ width: 64, height: 48 }, { width: 160, height: 160 }, { grow: true })).toEqual(
      { width: 160, height: 120 },
    );
  });

  it('keeps at least one pixel on each side', () => {
    expect(fitInto({ width: 4096, height: 1 }, { width: 512, height: 512 })).toEqual({
      width: 512,
      height: 1,
    });
  });
});
