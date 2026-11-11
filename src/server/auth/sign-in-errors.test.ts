/**
 * @file Tests for the error codes of sign-in errors (storing
 * them is covered by the integration tests).
 */
import { describe, expect, it } from 'vitest';

import { cleanErrorCode } from './sign-in-errors';

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
