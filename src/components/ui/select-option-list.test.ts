/**
 * @file Tests for the logic of a select's list: groups, what a search shows
 * and where the keys move the active option.
 */
import { describe, expect, it } from 'vitest';

import {
  foldForSearch,
  groupOptions,
  matchingOptions,
  matchRange,
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

describe('matchRange', () => {
  /** An acute accent written as a character of its own, after its letter (U+0301). */
  const COMBINING_ACUTE = String.fromCodePoint(0x301);
  /** The second letter of the Korean syllable 서, as the syllable folds into its letters. */
  const KOREAN_EO = String.fromCodePoint(0x1165);

  /**
   * The part of a text a search matches.
   *
   * @param text - The text.
   * @param query - What's typed.
   * @returns The matched part as it's written, or `null` for no match.
   */
  const matched = (text: string, query: string) => {
    const range = matchRange(text, query);
    return range && text.slice(range.start, range.end);
  };

  it('finds the first match, case and the spaces around what’s typed aside', () => {
    expect(matchRange('Amsterdam (UTC+01:00)', 'AMST')).toEqual({ start: 0, end: 4 });
    expect(matched('Amsterdam (UTC+01:00)', '  dam ')).toBe('dam');
    expect(matched('Europe', 'e')).toBe('E');
  });

  it('covers the letters as they’re written, with their accents', () => {
    expect(matched('São Paulo (UTC−03:00)', 'sao p')).toBe('São P');
    expect(matched('Sao Paulo', 'são')).toBe('Sao');
    expect(matched('İstanbul', 'ist')).toBe('İst');
  });

  it('keeps an accent written as a character of its own with its letter', () => {
    const cafe = `Cafe${COMBINING_ACUTE} Paris`;
    expect(matched(cafe, 'cafe')).toBe(`Cafe${COMBINING_ACUTE}`);
    expect(matched(cafe, 'é p')).toBe(`e${COMBINING_ACUTE} P`);
    expect(matched(cafe, 'paris')).toBe('Paris');
  });

  it('keeps any other character that folds to nothing out of the match’s end', () => {
    // A middle dot and a spacing accent fold to nothing, but aren't part of the letter before.
    expect(matched('l·l', 'l')).toBe('l');
    expect(matched('a^b', 'a')).toBe('a');
  });

  it('reads the minus sign of an offset as a hyphen', () => {
    expect(matched('New York (UTC−05:00)', '-05')).toBe('−05');
  });

  it('keeps a character whose folded form is longer whole', () => {
    // A Korean syllable folds into its letters: a match of one letter covers the syllable.
    expect(matched('서울', '서')).toBe('서');
    expect(matched('서울', KOREAN_EO)).toBe('서');
  });

  it('matches a word that ends in a capital sigma, which lower-cases to a final sigma', () => {
    expect(matched('ΟΔΟΣ', 'ος')).toBe('ΟΣ');
    expect(matched('ΑΣ ΑΘΗΝΑ', 'ας')).toBe('ΑΣ');
  });

  it('counts a character outside the first plane as the two it’s stored as', () => {
    expect(matched('Ice 🧊 Cave', 'cave')).toBe('Cave');
    expect(matched('Ice 🧊 Cave', '🧊')).toBe('🧊');
    expect(matched('🏳️‍🌈 Pride (UTC)', 'pride')).toBe('Pride');
    // A capital of the Deseret alphabet, two characters long, lower-cases to another two.
    expect(matched('𐐀𐐁 Deseret', '𐐩')).toBe('𐐁');
  });

  it('finds nothing for an empty search or a text that doesn’t match', () => {
    expect(matchRange('Europe', '')).toBeNull();
    expect(matchRange('Europe', '   ')).toBeNull();
    expect(matchRange('Europe', 'asia')).toBeNull();
  });

  it('marks the label or the heading wherever matchingOptions shows an option, and nowhere else', () => {
    const options = [
      ...zones,
      { label: `Cafe${COMBINING_ACUTE} Paris`, group: 'Europe' },
      { label: 'ΟΔΟΣ', group: 'Ελλάδα' },
      { label: 'Ice 🧊 Cave', group: 'Arctic' },
      { label: '서울', group: 'Asia' },
    ];
    const queries = ['a', 'eur', 'ος', 'cafe', 'é', 'cave', '-05', 'zur', '서', 'λλα'];
    queries.forEach((query) => {
      options.forEach((option) => {
        const inLabel = matchRange(option.label, query) !== null;
        const inHeading = option.group !== undefined && matchRange(option.group, query) !== null;
        expect(inLabel || inHeading).toBe(matchingOptions([option], query).length === 1);
        expect(inLabel).toBe(foldForSearch(option.label).includes(foldForSearch(query)));
      });
    });
    // One shown for its heading only: the heading is marked, the label isn't.
    const amsterdam = { label: 'Amsterdam (UTC+01:00)', group: 'Europe' };
    expect(matchingOptions([amsterdam], 'eur')).toEqual([amsterdam]);
    expect(matchRange(amsterdam.label, 'eur')).toBeNull();
    expect(matched(amsterdam.group, 'eur')).toBe('Eur');
  });
});
