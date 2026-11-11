/**
 * @file Tests for error references: the shared format, the reference a
 * digest gives (the same in the browser and on the server, checked against
 * fixed values), and reading the digest safely.
 */
import { describe, expect, it } from 'vitest';

import {
  errorDigest,
  formatReference,
  parseErrorReference,
  REFERENCE_ALPHABET,
  referenceFromDigest,
} from './error-reference';

/** A reference: two groups of four characters from the alphabet. */
const REFERENCE_PATTERN = /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

describe('formatReference', () => {
  it('writes eight characters in two groups of four', () => {
    expect(formatReference([...'7KQ2M9XD'])).toBe('7KQ2-M9XD');
  });

  it('uses an alphabet without characters that look alike', () => {
    ['0', 'O', '1', 'I', 'L'].forEach((character) => {
      expect(REFERENCE_ALPHABET).not.toContain(character);
    });
  });
});

describe('referenceFromDigest', () => {
  it('gives fixed references, so the browser and the server always agree', () => {
    expect(referenceFromDigest('2828711936')).toBe('TXCY-X79D');
    expect(referenceFromDigest('3496291841')).toBe('BY7B-CEKT');
    expect(referenceFromDigest('1')).toBe('N4DK-YS9Z');
    expect(referenceFromDigest('')).toBe('AZ4J-EHQ3');
  });

  it('gives the same reference for the same digest, in the format', () => {
    expect(referenceFromDigest('123456789012345')).toBe(referenceFromDigest('123456789012345'));
    expect(referenceFromDigest('123456789012345')).toMatch(REFERENCE_PATTERN);
  });

  it('gives different digests different references', () => {
    const references = Array.from({ length: 500 }, (_, index) =>
      referenceFromDigest(String(1_000_000_000 + index)),
    );

    references.forEach((reference) => expect(reference).toMatch(REFERENCE_PATTERN));
    expect(new Set(references).size).toBe(500);
  });
});

describe('errorDigest', () => {
  it("reads Next's digest from an error from the server", () => {
    expect(errorDigest(Object.assign(new Error('x'), { digest: '2828711936' }))).toBe('2828711936');
  });

  it('finds none in an error from the browser, or in a thrown value that is no error', () => {
    expect(errorDigest(new Error('x'))).toBeNull();
    expect(errorDigest(Object.assign(new Error('x'), { digest: '' }))).toBeNull();
    expect(errorDigest(Object.assign(new Error('x'), { digest: 42 }))).toBeNull();
    expect(errorDigest('2828711936')).toBeNull();
    expect(errorDigest(null)).toBeNull();
    expect(errorDigest(undefined)).toBeNull();
  });
});

describe('parseErrorReference', () => {
  it.each(['7KQ2-M9XD', '7kq2-m9xd', '7KQ2M9XD', ' 7kq2 m9xd ', '7KQ2 - M9XD'])(
    'reads %j as 7KQ2-M9XD',
    (input) => {
      expect(parseErrorReference(input)).toBe('7KQ2-M9XD');
    },
  );

  it.each(['', '7KQ2-M9X', '7KQ2-M9XDE', '7KQ0-M9XD', '7KQI-M9XD', '7KQ2_M9XD'])(
    'refuses %j, which no reference can be',
    (input) => {
      expect(parseErrorReference(input)).toBeNull();
    },
  );
});
