/**
 * @file Tests for reading a cookie's value.
 */
import { describe, expect, it } from 'vitest';

import { cookieValue } from './cookie-value';

describe('cookieValue', () => {
  it('finds a cookie among others, trimming the spaces', () => {
    expect(cookieValue('a=1; b=2 ;c=3', 'b')).toBe('2');
  });

  it('decodes the value and keeps any "=" in it', () => {
    expect(cookieValue('x=a%20b=c', 'x')).toBe('a b=c');
  });

  it('does not match a cookie whose name only ends the same', () => {
    expect(cookieValue('xa=1', 'a')).toBeNull();
  });

  it('returns null for a missing cookie or no cookies', () => {
    expect(cookieValue('a=1', 'b')).toBeNull();
    expect(cookieValue(null, 'a')).toBeNull();
    expect(cookieValue(undefined, 'a')).toBeNull();
    expect(cookieValue('', 'a')).toBeNull();
  });

  it('returns null for a malformed escape', () => {
    expect(cookieValue('a=%E0%A4%A', 'a')).toBeNull();
  });
});
