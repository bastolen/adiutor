/**
 * @file Tests for the logic of a select's list: groups, what a search shows
 * and where the keys move the active option.
 */
import { describe, expect, it } from 'vitest';

import {
  foldForSearch,
  groupOptions,
  matchingOptions,
  movedIndex,
  PAGE_STEP,
} from './select-option-list';

/** Zones as the time zone field lists them, under their regions. */
const zones = [
  { label: 'UTC' },
  { label: 'Abidjan (UTC)', group: 'Africa' },
  { label: 'Accra (UTC)', group: 'Africa' },
  { label: 'New York (UTC−05:00)', group: 'Americas' },
  { label: 'São Paulo (UTC−03:00)', group: 'Americas' },
  { label: 'Amsterdam (UTC+01:00)', group: 'Europe' },
  { label: 'Zürich (UTC+01:00)', group: 'Europe' },
];

describe('groupOptions', () => {
  it('puts options that follow each other under the same heading together, in order', () => {
    expect(groupOptions(zones).map(({ heading, options }) => [heading, options.length])).toEqual([
      [undefined, 1],
      ['Africa', 2],
      ['Americas', 2],
      ['Europe', 2],
    ]);
  });

  it('starts a new group when a heading comes back after another', () => {
    const options = [
      { label: 'One', group: 'A' },
      { label: 'Two', group: 'B' },
      { label: 'Three', group: 'A' },
    ];

    expect(groupOptions(options).map(({ heading }) => heading)).toEqual(['A', 'B', 'A']);
  });
});

describe('foldForSearch', () => {
  it('ignores case and accents, and reads the minus sign as a hyphen', () => {
    expect(foldForSearch('São Paulo (UTC−03:00)')).toBe('sao paulo (utc-03:00)');
  });
});

describe('matchingOptions', () => {
  /**
   * The labels of the options a search shows.
   *
   * @param query - What's typed.
   * @returns Their labels.
   */
  const labelsFor = (query: string) => matchingOptions(zones, query).map(({ label }) => label);

  it('shows every option while nothing is typed', () => {
    expect(labelsFor('')).toHaveLength(zones.length);
    expect(labelsFor('   ')).toHaveLength(zones.length);
  });

  it('shows the options whose label contains what is typed, anywhere in it, in their order', () => {
    expect(labelsFor('msterd')).toEqual(['Amsterdam (UTC+01:00)']);
    expect(labelsFor('york')).toEqual(['New York (UTC−05:00)']);
    expect(labelsFor('+01')).toEqual(['Amsterdam (UTC+01:00)', 'Zürich (UTC+01:00)']);
  });

  it('ignores case, accents and spaces around what is typed', () => {
    expect(labelsFor(' NEW YORK ')).toEqual(['New York (UTC−05:00)']);
    expect(labelsFor('sao')).toEqual(['São Paulo (UTC−03:00)']);
    expect(labelsFor('zur')).toEqual(['Zürich (UTC+01:00)']);
  });

  it('finds an offset with a minus typed as a hyphen', () => {
    expect(labelsFor('utc-05')).toEqual(['New York (UTC−05:00)']);
  });

  it('shows every option of a group whose heading contains what is typed', () => {
    expect(labelsFor('africa')).toEqual(['Abidjan (UTC)', 'Accra (UTC)']);
  });

  it('shows nothing when nothing contains what is typed', () => {
    expect(labelsFor('atlantis')).toEqual([]);
  });
});

describe('movedIndex', () => {
  it('moves one step with the arrow keys, stopping at the ends', () => {
    expect(movedIndex('ArrowDown', 0, 3)).toBe(1);
    expect(movedIndex('ArrowDown', 2, 3)).toBe(2);
    expect(movedIndex('ArrowUp', 1, 3)).toBe(0);
    expect(movedIndex('ArrowUp', 0, 3)).toBe(0);
  });

  it('starts at the first option when none is active', () => {
    expect(movedIndex('ArrowDown', -1, 3)).toBe(0);
    expect(movedIndex('ArrowUp', -1, 3)).toBe(0);
    expect(movedIndex('PageDown', -1, 30)).toBe(PAGE_STEP);
  });

  it('moves a page with PageDown and PageUp, stopping at the ends', () => {
    expect(movedIndex('PageDown', 0, 30)).toBe(PAGE_STEP);
    expect(movedIndex('PageDown', 25, 30)).toBe(29);
    expect(movedIndex('PageUp', 25, 30)).toBe(25 - PAGE_STEP);
    expect(movedIndex('PageUp', 3, 30)).toBe(0);
  });

  it('goes to the first and the last option with Home and End', () => {
    expect(movedIndex('Home', 7, 30)).toBe(0);
    expect(movedIndex('End', 7, 30)).toBe(29);
  });

  it('leaves other keys, and an empty list, alone', () => {
    expect(movedIndex('ArrowLeft', 1, 3)).toBeUndefined();
    expect(movedIndex('a', 1, 3)).toBeUndefined();
    expect(movedIndex('ArrowDown', -1, 0)).toBeUndefined();
  });
});
