/**
 * @file Tests for email address normalization.
 */
import { describe, expect, it } from 'vitest';

import { normalizeEmail } from './email-address';

describe('normalizeEmail', () => {
  it('trims and lower-cases an address', () => {
    expect(normalizeEmail('  User@Adiutor.test ')).toBe('user@adiutor.test');
  });

  it('gives null for a blank string or anything but a string', () => {
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});
