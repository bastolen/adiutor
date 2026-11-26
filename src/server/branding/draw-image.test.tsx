/**
 * @file Tests for drawing the brand's images: an upload is drawn again as a
 * PNG that fits its box and keeps nothing else of the file, and an image
 * that doesn't decode shows as nothing, which is how it's refused.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { imageFacts } from '@/lib/branding';

import { drawPng, isBlankPng, redrawImage } from './draw-image';

/** Adiutor's own logo as a PNG, 280 by 64 pixels. */
const LOGO_PNG = new Uint8Array(readFileSync('public/brand/logo.png'));

/** The same logo as a JPEG, with the Exif segment the converter wrote. */
const LOGO_JPEG = new Uint8Array(readFileSync('tests/fixtures/logo.jpg'));

/** Text that stands for personal data hidden in a file, which must never be served. */
const SECRET = 'adiutor-tests-location-52.37N-4.89E';

/**
 * A PNG with a text chunk holding {@link SECRET} after its header.
 *
 * @returns The PNG.
 */
function pngWithText(): Uint8Array {
  const body = Buffer.from(`Comment\0${SECRET}`, 'latin1');
  const type = Buffer.from('tEXt', 'latin1');
  const chunk = Buffer.alloc(12 + body.length);
  chunk.writeUInt32BE(body.length, 0);
  type.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, body])), 8 + body.length);
  // The signature (8 bytes) and the IHDR chunk (25 bytes) come first.
  return new Uint8Array(Buffer.concat([LOGO_PNG.subarray(0, 33), chunk, LOGO_PNG.subarray(33)]));
}

/**
 * A JPEG with an extra Exif segment holding {@link SECRET} after its start.
 *
 * @returns The JPEG.
 */
function jpegWithSecret(): Uint8Array {
  const body = Buffer.from(`Exif\0\0${SECRET}`, 'latin1');
  const segment = Buffer.alloc(4 + body.length);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(body.length + 2, 2);
  body.copy(segment, 4);
  return new Uint8Array(Buffer.concat([LOGO_JPEG.subarray(0, 2), segment, LOGO_JPEG.subarray(2)]));
}

/**
 * Whether bytes hold {@link SECRET} anywhere.
 *
 * @param bytes - The bytes.
 * @returns Whether they do.
 */
function holdsSecret(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).includes(SECRET);
}

describe('redrawImage', () => {
  it('draws a PNG again at its own size when it fits, as a PNG without its text', async () => {
    const original = pngWithText();
    expect(holdsSecret(original)).toBe(true);
    const facts = imageFacts(original);
    expect(facts).not.toBeNull();
    if (!facts) {
      return;
    }

    const drawn = await redrawImage(original, facts, { width: 1024, height: 256 });

    expect(drawn).not.toBeNull();
    expect(drawn && imageFacts(drawn.content)).toEqual({ type: 'png', width: 280, height: 64 });
    expect(drawn && holdsSecret(drawn.content)).toBe(false);
  });

  it('draws a JPEG as a PNG that fits a smaller box, without its Exif data', async () => {
    const original = jpegWithSecret();
    const facts = imageFacts(original);
    expect(facts).toEqual({ type: 'jpeg', width: 280, height: 64 });
    if (!facts) {
      return;
    }

    const drawn = await redrawImage(original, facts, { width: 140, height: 140 });

    expect(drawn).toMatchObject({ width: 140, height: 32 });
    expect(drawn && imageFacts(drawn.content)).toEqual({ type: 'png', width: 140, height: 32 });
    expect(drawn && holdsSecret(drawn.content)).toBe(false);
  });

  it('gives nothing for an image that doesn’t decode past its header', async () => {
    const broken = new Uint8Array([...LOGO_PNG.subarray(0, 40), ...new Uint8Array(400).fill(7)]);
    const facts = imageFacts(broken);
    expect(facts).not.toBeNull();
    if (!facts) {
      return;
    }

    expect(await redrawImage(broken, facts, { width: 1024, height: 256 })).toBeNull();
  });
});

describe('isBlankPng', () => {
  it('tells an empty drawing from one with something in it', async () => {
    const empty = await drawPng(
      <div style={{ display: 'flex', width: '100%', height: '100%' }} />,
      {
        width: 32,
        height: 32,
      },
    );
    const filled = await drawPng(
      <div style={{ display: 'flex', width: '100%', height: '100%', background: '#0f766e' }} />,
      { width: 32, height: 32 },
    );

    expect(isBlankPng(empty)).toBe(true);
    expect(isBlankPng(filled)).toBe(false);
  });

  it('never counts a PNG that isn’t 8-bit RGBA as empty', () => {
    const grey = new Uint8Array(LOGO_PNG);
    // The colour type, after the signature, the chunk's length and type, the size and the bit depth.
    grey[25] = 0;
    expect(isBlankPng(grey)).toBe(false);
  });
});
