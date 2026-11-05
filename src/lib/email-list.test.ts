/**
 * @file Tests for parsing lists of email addresses.
 */
import { describe, expect, it } from 'vitest';

import { parseEmailList } from './email-list';

describe('parseEmailList', () => {
  it('splits on new lines, commas, semicolons and spaces', () => {
    expect(
      parseEmailList(
        'jane@adiutor.test\nsam@adiutor.test, alex@adiutor.test; kim@adiutor.test pat@adiutor.test',
      ),
    ).toEqual({
      emails: [
        'jane@adiutor.test',
        'sam@adiutor.test',
        'alex@adiutor.test',
        'kim@adiutor.test',
        'pat@adiutor.test',
      ],
      invalid: [],
    });
  });

  it('normalizes case and removes duplicates', () => {
    expect(parseEmailList('Jane@Adiutor.test, jane@adiutor.test').emails).toEqual([
      'jane@adiutor.test',
    ]);
  });

  it('reports invalid entries as typed', () => {
    expect(parseEmailList('jane@adiutor.test, not-an-email, @adiutor.test')).toEqual({
      emails: ['jane@adiutor.test'],
      invalid: ['not-an-email', '@adiutor.test'],
    });
  });

  it('is empty for blank input', () => {
    expect(parseEmailList('  \n ')).toEqual({ emails: [], invalid: [] });
  });
});
