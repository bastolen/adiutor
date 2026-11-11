/**
 * @file Tests for drawing a random error reference.
 */
import { describe, expect, it } from 'vitest';

import { REFERENCE_ALPHABET } from '@/lib/error-reference';

import { createReference } from './error-reference';

describe('createReference', () => {
  it('makes two groups of four characters that are easy to read out', () => {
    const references = Array.from({ length: 200 }, () => createReference());

    references.forEach((reference) => {
      expect(reference).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    });
    expect(new Set(references).size).toBeGreaterThan(195);
  });

  it('leaves out characters that look alike', () => {
    ['0', 'O', '1', 'I', 'L'].forEach((character) => {
      expect(REFERENCE_ALPHABET).not.toContain(character);
    });
  });
});
