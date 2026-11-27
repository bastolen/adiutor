/**
 * @file Tests for reading the start of a text file: UTF-8 and UTF-16 after
 * their byte order marks, no character cut in half at the end, and never
 * more than 200 KB even from a server that sends the whole file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeTextStart, readTextStart, TEXT_PREVIEW_BYTES } from './attachment-text';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decodeTextStart', () => {
  it('decodes UTF-8, with or without its mark, and UTF-16 in either order', () => {
    expect(decodeTextStart(new TextEncoder().encode('printer offline'), false)).toBe(
      'printer offline',
    );
    expect(decodeTextStart(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]), false)).toBe('hi');
    expect(decodeTextStart(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]), false)).toBe('hi');
    expect(decodeTextStart(new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]), false)).toBe('hi');
  });

  it('drops a character cut in half at the end of a file that goes on', () => {
    const cafe = new TextEncoder().encode('café');
    expect(decodeTextStart(cafe.subarray(0, cafe.length - 1), true)).toBe('caf');
    expect(decodeTextStart(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69]), true)).toBe('h');
  });
});

describe('readTextStart', () => {
  it('asks for the start of the file, and says when it goes on', async () => {
    const fetch = vi.fn(async () => new Response('printer', { status: 206 }));
    vi.stubGlobal('fetch', fetch);

    expect(await readTextStart('/attachments/x', 15, new AbortController().signal)).toEqual({
      text: 'printer',
      cut: true,
    });
    expect(fetch).toHaveBeenCalledWith('/attachments/x', {
      headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` },
      signal: expect.any(AbortSignal),
    });
  });

  it('reads no more than 200 KB from a server that sends the whole file', async () => {
    vi.stubGlobal('fetch', async () => new Response('x'.repeat(TEXT_PREVIEW_BYTES + 5000)));
    const start = await readTextStart(
      '/attachments/x',
      TEXT_PREVIEW_BYTES + 5000,
      new AbortController().signal,
    );
    expect(start.text).toHaveLength(TEXT_PREVIEW_BYTES);
    expect(start.cut).toBe(true);
  });

  it('fails for a file it can’t read', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }));
    await expect(
      readTextStart('/attachments/x', 5, new AbortController().signal),
    ).rejects.toThrow();
  });
});
