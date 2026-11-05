/**
 * @file Tests for checked access to values that may be missing: the value
 * comes back as it is (falsy ones included), and a missing one throws with
 * what was expected.
 */
import { describe, expect, it } from 'vitest';

import { defined, firstRow } from './defined';

describe('defined', () => {
  it.each([0, '', false, 'value'])('returns %j as it is', (value) => {
    expect(defined(value, 'the value')).toBe(value);
  });

  it.each([undefined, null])('throws, naming what was expected, for %s', (value) => {
    expect(() => defined(value, 'the first email')).toThrow('Expected the first email');
  });
});

describe('firstRow', () => {
  it('returns the first row', () => {
    expect(firstRow([{ id: 'a' }, { id: 'b' }], 'the new company')).toEqual({ id: 'a' });
  });

  it('throws, naming the row, for an empty result', () => {
    expect(() => firstRow([], 'the new company')).toThrow('Expected the new company');
  });
});
