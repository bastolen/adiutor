/**
 * @file Tests for a request's number as people see and type it.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REQUEST_PREFIX,
  formatRequestNumber,
  parseRequestNumber,
  REQUEST_PREFIX_PATTERN,
  requestNumberStartInSearch,
  requestPath,
} from './number';

describe('formatRequestNumber', () => {
  it('writes the number after the prefix', () => {
    expect(formatRequestNumber(DEFAULT_REQUEST_PREFIX, 142)).toBe('AD-142');
    expect(formatRequestNumber('HELP', 7)).toBe('HELP-7');
  });
});

describe('REQUEST_PREFIX_PATTERN', () => {
  it.each(['AD', 'A', 'REQ', 'HELP1', 'A1'])('accepts %s', (prefix) => {
    expect(REQUEST_PREFIX_PATTERN.test(prefix)).toBe(true);
  });

  it.each(['', 'ad', '1A', 'TOOLONG', 'A-B', 'A B', 'É'])('refuses %j', (prefix) => {
    expect(REQUEST_PREFIX_PATTERN.test(prefix)).toBe(false);
  });
});

describe('parseRequestNumber', () => {
  it('reads a number from an address', () => {
    expect(parseRequestNumber('142')).toBe(142);
    expect(parseRequestNumber('999999999')).toBe(999_999_999);
  });

  it.each(['0', '0142', '-1', '1.5', '1e3', 'AD-142', '', ' 142', '1234567890'])(
    'refuses %j',
    (segment) => {
      expect(parseRequestNumber(segment)).toBeNull();
    },
  );
});

describe('requestNumberStartInSearch', () => {
  it.each(['142', '#142', 'AD-142', 'ad-142', 'AD 142', 'AD142', ' ad-142 ', 'REQ-142', 'A1-142'])(
    'finds the digits 142 in %j',
    (term) => {
      expect(requestNumberStartInSearch(term)).toBe('142');
    },
  );

  it.each([
    ['1', '1'],
    ['AD-1', '1'],
    ['#10', '10'],
    ['ad-100200300', '100200300'],
  ])('gives the digits of %j as they were typed: what a number starts with', (term, digits) => {
    expect(requestNumberStartInSearch(term)).toBe(digits);
  });

  it.each(['printer', 'floor 2 printer', 'AD-', '0', 'AD-0', '142 printers', 'TOOLONG-142', ''])(
    'finds no number in %j',
    (term) => {
      expect(requestNumberStartInSearch(term)).toBeNull();
    },
  );
});

describe('requestPath', () => {
  it('is the number under /requests', () => {
    expect(requestPath(142)).toBe('/requests/142');
  });
});
