/**
 * @file Tests for the name shown for a user.
 */
import { describe, expect, it } from 'vitest';

import displayName from './display-name';

describe('displayName', () => {
  it('shows the display name, trimmed', () => {
    expect(displayName({ name: '  Alex Admin ', email: 'admin@adiutor.test' })).toBe('Alex Admin');
  });

  it.each(['', '   ', null, undefined])('falls back to the email address for %j', (name) => {
    expect(displayName({ name, email: 'admin@adiutor.test' })).toBe('admin@adiutor.test');
  });

  it.each([
    ['a Hangul filler', '\u{3164}'],
    ['a half-width Hangul filler between spaces', ' \u{FFA0} '],
    ['zero-width joiners', '\u{200D}\u{200C}'],
    ['a zero-width space', '\u{200B}'],
    ['tag characters', '\u{E0041}\u{E007F}'],
    ['an accent without a letter', '\u{301}'],
  ])(
    'falls back to the email address for a saved name of only %s, which shows nothing',
    (_what, name) => {
      expect(displayName({ name, email: 'admin@adiutor.test' })).toBe('admin@adiutor.test');
    },
  );

  it('keeps a name that has something to see next to such characters', () => {
    expect(
      displayName({ name: '\u{645}\u{6CC}\u{200C}\u{62E}', email: 'admin@adiutor.test' }),
    ).toBe('\u{645}\u{6CC}\u{200C}\u{62E}');
    expect(displayName({ name: '\u{2764}\u{FE0F}', email: 'admin@adiutor.test' })).toBe(
      '\u{2764}\u{FE0F}',
    );
  });
});
