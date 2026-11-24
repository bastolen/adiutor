/**
 * @file Tests for reading a thrown error's code: on the error, through the
 * causes Drizzle wraps around the driver's error, and nothing else.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import errorCode from './error-code';

describe('errorCode', () => {
  it("reads the error's own code, or the first one among its causes", () => {
    const driver = Object.assign(new Error('driver'), { code: '23505' });

    expect(errorCode(driver)).toBe('23505');
    expect(errorCode(new Error('Failed query', { cause: driver }))).toBe('23505');
    expect(
      errorCode(Object.assign(new Error('outer'), { code: 'ECONNREFUSED', cause: driver })),
    ).toBe('ECONNREFUSED');
  });

  it('skips a code that is not text, and stops three causes deep', () => {
    const driver = Object.assign(new Error('driver'), { code: '40P01' });
    /**
     * Wraps the driver's error the given number of times.
     *
     * @param depth - How many wrappers.
     * @returns The outermost error.
     */
    const wrapped = (depth: number): unknown =>
      depth === 0 ? driver : new Error('wrapper', { cause: wrapped(depth - 1) });

    expect(errorCode(Object.assign(new Error('outer'), { code: 40, cause: driver }))).toBe('40P01');
    expect(errorCode(wrapped(3))).toBe('40P01');
    expect(errorCode(wrapped(4))).toBeNull();
  });

  it('gives null for anything without a code', () => {
    [new Error('nope'), { code: 40 }, null, undefined, '40P01'].forEach((value) => {
      expect(errorCode(value)).toBeNull();
    });
  });
});
