/**
 * @file Tests for checking a file's bytes against its type: each kind's
 * signature, text in UTF-8 and UTF-16, and the lookalikes that must fail
 * (an HTML page named `.png`, a program named `.txt`, an image named as a
 * video).
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import matchesAttachmentKind from './attachment-checks';

/**
 * Bytes from numbers and text.
 *
 * @param parts - Numbers (bytes) and strings (Latin-1 text).
 * @returns The bytes.
 */
function bytesOf(...parts: (number | string)[]): Uint8Array {
  return new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'number' ? [part] : [...part].map((character) => character.charCodeAt(0)),
    ),
  );
}

/**
 * An ISO media file's start: a box size, `ftyp` and a brand.
 *
 * @param brand - Its major brand.
 * @returns The bytes.
 */
const iso = (brand: string) => bytesOf(0, 0, 0, 24, 'ftyp', brand, 0, 0, 0, 0);

describe('matchesAttachmentKind', () => {
  it.each([
    ['png', bytesOf(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)],
    ['jpeg', bytesOf(0xff, 0xd8, 0xff, 0xe0)],
    ['gif', bytesOf('GIF89a', 1, 0)],
    ['webp', bytesOf('RIFF', 0, 0, 0, 0, 'WEBPVP8 ')],
    ['heic', iso('heic')],
    ['pdf', bytesOf('%PDF-1.7\n')],
    ['zip', bytesOf('PK', 3, 4, 20, 0)],
    ['7z', bytesOf(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)],
    ['gzip', bytesOf(0x1f, 0x8b, 0x08, 0)],
    ['mp4', iso('isom')],
    ['mov', iso('qt  ')],
    ['webm', bytesOf(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84, 'webm')],
  ] as const)('accepts a %s by its signature', (kind, bytes) => {
    expect(matchesAttachmentKind(kind, bytes)).toBe(true);
  });

  it('accepts a PDF whose header comes a little way in, and an empty archive', () => {
    expect(matchesAttachmentKind('pdf', bytesOf(' '.repeat(500), '%PDF-1.4'))).toBe(true);
    expect(matchesAttachmentKind('zip', bytesOf('PK', 5, 6, 0, 0))).toBe(true);
    expect(matchesAttachmentKind('mov', bytesOf(0, 0, 0, 8, 'moov'))).toBe(true);
  });

  it('refuses lookalikes', () => {
    const html = bytesOf('<!doctype html><script>alert(1)</script>');
    expect(matchesAttachmentKind('png', html)).toBe(false);
    expect(matchesAttachmentKind('pdf', html)).toBe(false);
    expect(matchesAttachmentKind('heic', iso('isom'))).toBe(false);
    expect(matchesAttachmentKind('mp4', iso('heic'))).toBe(false);
    expect(matchesAttachmentKind('mp4', iso('qt  '))).toBe(false);
    expect(matchesAttachmentKind('webm', bytesOf(0x1a, 0x45, 0xdf, 0xa3, 'matroska'))).toBe(false);
    expect(matchesAttachmentKind('gif', bytesOf('GIF90a'))).toBe(false);
    expect(matchesAttachmentKind('jpeg', new Uint8Array())).toBe(false);
  });

  it('takes UTF-8 text, with or without its mark, and never a NUL byte or broken UTF-8', () => {
    const encoder = new TextEncoder();
    expect(matchesAttachmentKind('text', encoder.encode('2026-11-25 printer: offline ✓\n'))).toBe(
      true,
    );
    expect(matchesAttachmentKind('text', bytesOf(0xef, 0xbb, 0xbf, 'a,b\n'))).toBe(true);
    // A program named `.txt`.
    expect(matchesAttachmentKind('text', bytesOf('MZ', 0x90, 0, 3, 0))).toBe(false);
    expect(matchesAttachmentKind('text', bytesOf('caf', 0xe9))).toBe(false);
  });

  it('takes UTF-16 text after its mark, with surrogates in pairs and no U+0000', () => {
    /**
     * UTF-16 little-endian, after its mark.
     *
     * @param units - The code units.
     * @returns The bytes.
     */
    const utf16 = (...units: number[]) =>
      new Uint8Array([
        0xff,
        0xfe,
        ...units.flatMap((unit) => [unit % 256, Math.floor(unit / 256)]),
      ]);
    // A Windows log: "OK" and an emoji (a surrogate pair).
    expect(matchesAttachmentKind('text', utf16(0x4f, 0x4b, 0xd83d, 0xde00))).toBe(true);
    // Big-endian works too.
    expect(matchesAttachmentKind('text', new Uint8Array([0xfe, 0xff, 0, 0x4f]))).toBe(true);
    expect(matchesAttachmentKind('text', utf16(0x4f, 0))).toBe(false);
    expect(matchesAttachmentKind('text', utf16(0xd83d))).toBe(false);
    expect(matchesAttachmentKind('text', utf16(0xde00, 0x4f))).toBe(false);
    expect(matchesAttachmentKind('text', new Uint8Array([0xff, 0xfe, 0x4f]))).toBe(false);
  });
});
