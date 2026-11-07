/**
 * @file Tests for the references and error codes of sign-in errors (storing
 * them is covered by the integration tests).
 */
import { describe, expect, it } from 'vitest';

import { cleanErrorCode, createReference, REFERENCE_ALPHABET } from './sign-in-errors';

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

describe('cleanErrorCode', () => {
  it("keeps Better Auth's codes", () => {
    expect(cleanErrorCode('state_mismatch')).toBe('state_mismatch');
    expect(cleanErrorCode("email_doesn't_match")).toBe("email_doesn't_match");
    expect(cleanErrorCode('INVALID_TOKEN')).toBe('INVALID_TOKEN');
  });

  it("turns anything else into UNKNOWN, so it's never stored or logged as given", () => {
    expect(cleanErrorCode(null)).toBe('UNKNOWN');
    expect(cleanErrorCode(undefined)).toBe('UNKNOWN');
    expect(cleanErrorCode('')).toBe('UNKNOWN');
    expect(cleanErrorCode('<script>alert(1)</script>')).toBe('UNKNOWN');
    expect(cleanErrorCode('a b')).toBe('UNKNOWN');
    expect(cleanErrorCode('x'.repeat(101))).toBe('UNKNOWN');
  });
});
