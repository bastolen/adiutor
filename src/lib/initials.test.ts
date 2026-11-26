/**
 * @file Tests for initials made from a name.
 */
import { describe, expect, it } from 'vitest';

import initialsOf from './initials';

describe('initialsOf', () => {
  it('takes the first letters of the first two words of a name', () => {
    expect(initialsOf('Jane Doe')).toBe('JD');
    expect(initialsOf('ada king lovelace')).toBe('AK');
  });

  it('takes the first two letters of a single word', () => {
    expect(initialsOf('Adiutor')).toBe('AD');
    expect(initialsOf('x')).toBe('X');
  });

  it('uses the part of an email address before the @, split on dots, dashes and underscores', () => {
    expect(initialsOf('jane@adiutor.test')).toBe('JA');
    expect(initialsOf('jane.doe@adiutor.test')).toBe('JD');
    expect(initialsOf('mary-jane_doe@adiutor.test')).toBe('MJ');
  });

  it('treats a dotted name without an @ the same way', () => {
    expect(initialsOf('a.b')).toBe('AB');
  });

  it('never cuts a character in half', () => {
    expect(initialsOf('𝒜da 𝒝ob')).toBe('𝒜𝒝');
    expect(initialsOf('😀smile')).toBe('😀S');
    expect(initialsOf('Éva')).toBe('ÉV');
    expect(initialsOf('e\u0301va')).toBe('ÉV');
  });

  it('gives a question mark when there is nothing to take letters from', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('@adiutor.test')).toBe('?');
  });
});
