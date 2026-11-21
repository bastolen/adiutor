/**
 * @file Tests for telling a person's click from a program's visit.
 */
import { describe, expect, it } from 'vitest';

import isPersonsClick from './persons-click';

describe('isPersonsClick', () => {
  it('is a navigation the browser says a person caused', () => {
    expect(isPersonsClick(new Headers({ 'sec-fetch-user': '?1' }))).toBe(true);
    expect(
      isPersonsClick(new Headers({ 'sec-fetch-user': '?1', 'sec-fetch-site': 'cross-site' })),
    ).toBe(true);
  });

  it("isn't a request without the header, as programs and prefetches make", () => {
    expect(isPersonsClick(new Headers())).toBe(false);
    expect(isPersonsClick(new Headers({ 'sec-fetch-site': 'none' }))).toBe(false);
    expect(isPersonsClick(new Headers({ 'sec-fetch-user': '?0' }))).toBe(false);
  });
});
