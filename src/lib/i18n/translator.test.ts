/**
 * @file Tests for translating outside React (emails, services, scripts):
 * each language, with named arguments it may place in its own order.
 */
import { describe, expect, it } from 'vitest';

import translator from './translator';

describe('translator', () => {
  it.each([
    ['en-US', 'Showing 26–50 of 1,320'],
    ['nl-NL', '26–50 van 1.320'],
    ['es-ES', '26–50 de 1320'],
  ] as const)('formats numbers in their places in %s', (locale, expected) => {
    expect(
      translator(locale, 'common.pagination')('showing', { first: 26, last: 50, total: 1320 }),
    ).toBe(expected);
  });

  it('lets a language put the arguments in its own order', () => {
    expect(translator('en-US', 'requests.board')('moveCard', { reference: 'AD-142' })).toBe(
      'Move AD-142',
    );
    expect(translator('nl-NL', 'requests.board')('moveCard', { reference: 'AD-142' })).toBe(
      'AD-142 verplaatsen',
    );
  });
});
