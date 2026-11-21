/**
 * @file Tests for telling a person's click from a program's visit.
 */
import { describe, expect, it } from 'vitest';

import isPersonsClick from './persons-click';

describe('isPersonsClick', () => {
  it('is a click when the browser says a person caused the navigation', () => {
    expect(isPersonsClick(new Headers({ 'sec-fetch-user': '?1' }))).toBe(true);
  });

  it('isn’t one without the header, or with another value', () => {
    expect(isPersonsClick(new Headers())).toBe(false);
    expect(isPersonsClick(new Headers({ 'sec-fetch-user': '?0' }))).toBe(false);
    expect(isPersonsClick(new Headers({ 'sec-fetch-site': 'none' }))).toBe(false);
  });
});
