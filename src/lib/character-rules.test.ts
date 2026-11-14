/**
 * @file Tests for the character checks shared by the input validation and
 * the request text cleaning.
 */
import { describe, expect, it } from 'vitest';

import { hasControlCharacter, hasHiddenCharacter } from './character-rules';

describe('hasControlCharacter', () => {
  it.each([
    ['a line break', 'Adiutor\nTests'],
    ['a tab', 'Adiutor\tTests'],
    ['a null character', 'Adiutor\u0000Tests'],
    ['delete', 'Adiutor\u007fTests'],
    ['a C1 control', 'Adiutor\u0085Tests'],
  ])('finds %s', (_name, value) => {
    expect(hasControlCharacter(value)).toBe(true);
  });

  it('accepts ordinary text in any script', () => {
    expect(hasControlCharacter('Adiutor Tests, Zoë & علی 🙂')).toBe(false);
  });
});

describe('hasHiddenCharacter', () => {
  it.each([
    ['a right-to-left override', 'Adiutor\u{202E}Tests'],
    ['a zero-width space', 'Adiutor\u{200B}Tests'],
    ['a byte order mark', '\u{FEFF}Adiutor'],
    ['a line separator', 'Adiutor\u{2028}Tests'],
    ['a directional isolate', 'Adiutor\u{2066}Tests'],
  ])('finds %s', (_name, value) => {
    expect(hasHiddenCharacter(value)).toBe(true);
  });

  it('allows the joiners that names and emoji need', () => {
    expect(hasHiddenCharacter('می\u{200C}خواهم')).toBe(false);
    expect(hasHiddenCharacter('👩\u{200D}💻')).toBe(false);
  });
});
