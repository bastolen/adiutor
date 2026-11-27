/**
 * @file Tests for the part of a file a browser asks for: one range from a
 * byte to a byte, to the end, or the last few bytes, resolved against the
 * file's size; the whole file for anything else; nothing past its end.
 */
import { describe, expect, it } from 'vitest';

import { parseRange, rangeHeader, resolveRange } from './byte-range';

describe('parseRange', () => {
  it('reads one range: to a byte, to the end, or the last few bytes', () => {
    expect(parseRange('bytes=0-99')).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=100-')).toEqual({ start: 100, end: null });
    expect(parseRange('bytes=-500')).toEqual({ suffix: 500 });
  });

  it('asks for the whole file for several ranges, or anything it doesn’t read', () => {
    for (const header of [
      null,
      '',
      'bytes=0-1,5-9',
      'bytes=9-5',
      'bytes=-0',
      'items=0-9',
      'bytes=a-b',
      'bytes=-',
      'bytes=1234567890123456-',
    ]) {
      expect(parseRange(header), String(header)).toBeNull();
    }
  });
});

describe('resolveRange', () => {
  it('fits a range to the file', () => {
    expect(resolveRange({ start: 0, end: 99 }, 1000)).toEqual({ start: 0, end: 99 });
    expect(resolveRange({ start: 900, end: 2000 }, 1000)).toEqual({ start: 900, end: 999 });
    expect(resolveRange({ start: 10, end: null }, 1000)).toEqual({ start: 10, end: 999 });
    expect(resolveRange({ suffix: 100 }, 1000)).toEqual({ start: 900, end: 999 });
    expect(resolveRange({ suffix: 5000 }, 1000)).toEqual({ start: 0, end: 999 });
  });

  it('gives nothing for a range past the end, or of an empty file', () => {
    expect(resolveRange({ start: 1000, end: null }, 1000)).toBeNull();
    expect(resolveRange({ suffix: 10 }, 0)).toBeNull();
  });
});

describe('rangeHeader', () => {
  it('writes a range back as a header', () => {
    expect(rangeHeader({ start: 0, end: 99 })).toBe('bytes=0-99');
    expect(rangeHeader({ start: 100, end: null })).toBe('bytes=100-');
    expect(rangeHeader({ suffix: 500 })).toBe('bytes=-500');
  });
});
