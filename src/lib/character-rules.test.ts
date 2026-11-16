/**
 * @file Tests for the character checks shared by the input validation, the
 * request text cleaning and the cleaning of untrusted text on the server.
 */
import { describe, expect, it } from 'vitest';

import {
  hasControlCharacter,
  hasHiddenCharacter,
  withoutControlCharacters,
} from './character-rules';

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

describe('withoutControlCharacters', () => {
  it('drops every control character, and nothing else', () => {
    expect(withoutControlCharacters('Adi\u0000utor\r\n Tests\u007f\u0085')).toBe('Adiutor Tests');
    expect(withoutControlCharacters('\u0000')).toBe('');
    expect(withoutControlCharacters('Adiutor Tests, Zoë & علی 🙂')).toBe(
      'Adiutor Tests, Zoë & علی 🙂',
    );
  });

  it('puts the replacement where each run of them was', () => {
    expect(withoutControlCharacters('/dashboard\r\n\tApp error', ' ')).toBe('/dashboard App error');
    expect(withoutControlCharacters('one\ntwo\nthree', ' ')).toBe('one two three');
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
