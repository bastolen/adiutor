/**
 * @file Tests for reading values from a page's query string.
 */
import { describe, expect, it } from 'vitest';

import { searchParam } from './search-params';

describe('searchParam', () => {
  it('returns a single value', () => {
    expect(searchParam('adiutor')).toBe('adiutor');
    expect(searchParam('')).toBe('');
  });

  it('treats a missing or repeated parameter as missing', () => {
    expect(searchParam(undefined)).toBeUndefined();
    expect(searchParam(['a', 'b'])).toBeUndefined();
  });
});
