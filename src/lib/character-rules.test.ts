/**
 * @file Tests for the character checks shared by the input validation, the
 * request text cleaning and the cleaning of untrusted text on the server.
 */
import { describe, expect, it } from 'vitest';

import {
  hasControlCharacter,
  hasHiddenCharacter,
  hasVisibleCharacter,
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

  it('keeps the control characters it is told to keep', () => {
    expect(withoutControlCharacters('one\r\n\ttwo\u0000\u0085', '', '\t\n')).toBe('one\n\ttwo');
    // A kept character ends a run: each side of it gets its own replacement.
    expect(withoutControlCharacters('a\u0000\n\u0000b', ' ', '\n')).toBe('a \n b');
  });
});

describe('hasHiddenCharacter', () => {
  it.each([
    ['a right-to-left override', 'Adiutor\u{202E}Tests'],
    ['a zero-width space', 'Adiutor\u{200B}Tests'],
    ['a byte order mark', '\u{FEFF}Adiutor'],
    ['a line separator', 'Adiutor\u{2028}Tests'],
    ['a directional isolate', 'Adiutor\u{2066}Tests'],
    ['a combining grapheme joiner', 'Adiutor\u{034F}Tests'],
    ['a Hangul choseong filler', 'Adiutor\u{115F}Tests'],
    ['a Hangul jungseong filler', 'Adiutor\u{1160}Tests'],
    ['a Khmer inherent vowel', 'Adiutor\u{17B4}Tests'],
    ['the other Khmer inherent vowel', 'Adiutor\u{17B5}Tests'],
    ['a Mongolian vowel separator', 'Adiutor\u{180E}Tests'],
    ['the unassigned format character', 'Adiutor\u{2065}Tests'],
    ['a deprecated format character', 'Adiutor\u{206A}Tests'],
    ['the last deprecated format character', 'Adiutor\u{206F}Tests'],
    ['a Hangul filler', '\u{3164}'],
    ['a half-width Hangul filler', 'Adiutor\u{FFA0}Tests'],
    ['a tag character', '\u{E0041}x'],
    ['the first tag character', 'Adiutor\u{E0000}'],
    ['the cancel tag', 'Adiutor\u{E007F}'],
  ])('finds %s', (_name, value) => {
    expect(hasHiddenCharacter(value)).toBe(true);
  });

  it('allows the joiners that names and emoji need, and the emoji variation selector', () => {
    expect(hasHiddenCharacter('می\u{200C}خواهم')).toBe(false);
    expect(hasHiddenCharacter('👩\u{200D}💻')).toBe(false);
    expect(hasHiddenCharacter('Adiutor Tests \u{2764}\u{FE0F}')).toBe(false);
    // The characters next to the ranges stay allowed.
    expect(hasHiddenCharacter('\u{2070}\u{3163}\u{3165}\u{FFA1}\u{E0080}')).toBe(false);
  });
});

describe('hasVisibleCharacter', () => {
  it.each([
    ['a letter', 'a'],
    ['a digit', '7'],
    ['punctuation', '-'],
    ['an emoji', '🙂'],
    ['an emoji made with a variation selector', '\u{2764}\u{FE0F}'],
    ['a Persian name with a zero-width non-joiner', 'می\u{200C}خواهم'],
    ['a letter with an accent of its own', 'e\u{301}'],
    ['a letter among invisible characters', '\u{200D}\u{3164} a \u{200B}'],
  ])('sees %s', (_name, value) => {
    expect(hasVisibleCharacter(value)).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['spaces of every kind', ' \u{A0}\u{2003}\u{3000}'],
    ['a zero-width non-joiner', '\u{200C}'],
    ['zero-width joiners', '\u{200D}\u{200D}'],
    ['a Hangul filler', '\u{3164}'],
    ['a half-width Hangul filler', '\u{FFA0}'],
    ['a soft hyphen', '\u{AD}'],
    ['an accent without a letter', '\u{301}'],
    ['a variation selector without a character', '\u{FE0F}'],
    ['tag characters', '\u{E0041}\u{E007F}'],
    ['a blank Braille pattern', '\u{2800}'],
    ['control characters', '\u{0}\n\t'],
  ])('sees nothing in %s', (_name, value) => {
    expect(hasVisibleCharacter(value)).toBe(false);
  });
});
