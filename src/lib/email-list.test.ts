/**
 * @file Tests for parsing lists of email addresses.
 */
import { describe, expect, it } from 'vitest';

import { parseEmailList } from './email-list';
import { MAX_BULK_INVITES } from './input-rules';

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

  it('reads a list of the most addresses one invitation takes to its end, duplicates and all', () => {
    const addresses = Array.from(
      { length: MAX_BULK_INVITES },
      (_, index) => `user${index}@adiutor.test`,
    );
    const repeated = [...addresses, ...addresses, ...addresses].join('\n');
    expect(parseEmailList(repeated)).toEqual({ emails: addresses, invalid: [] });
  });

  it('stops once it has found more entries than one invitation takes', () => {
    const addresses = Array.from({ length: 100_000 }, (_, index) => `u${index}@adiutor.test`);

    const started = performance.now();
    const list = parseEmailList(addresses.join(','));
    const took = performance.now() - started;

    // One more than the limit is enough to refuse it.
    expect(list).toEqual({ emails: addresses.slice(0, MAX_BULK_INVITES + 1), invalid: [] });
    // Looking for each address among those before it took tens of seconds; this, milliseconds.
    expect(took).toBeLessThan(1000);

    const mixed = parseEmailList(['nope', ...addresses].join(' '));
    expect(mixed.invalid).toEqual(['nope']);
    expect(mixed.emails).toEqual(addresses.slice(0, MAX_BULK_INVITES));
  });

  it('reads a megabyte of one address repeated quickly', () => {
    const started = performance.now();
    const list = parseEmailList('jane@adiutor.test\n'.repeat(55_000));
    const took = performance.now() - started;

    expect(list).toEqual({ emails: ['jane@adiutor.test'], invalid: [] });
    expect(took).toBeLessThan(1000);
  });
});
