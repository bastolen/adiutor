/**
 * @file Tests for the time zone rules: which names Adiutor accepts, how an
 * offset is written, and the list people pick from.
 */
import { describe, expect, it } from 'vitest';

import { isTimeZone, timeZoneOffset, timeZoneOptions } from './time-zones';

describe('isTimeZone', () => {
  it.each(['UTC', 'Europe/Amsterdam', 'America/Port-au-Prince', 'Asia/Kolkata', 'Europe/Kyiv'])(
    'accepts %s',
    (zone) => {
      expect(isTimeZone(zone)).toBe(true);
    },
  );

  it.each([
    ['a name the runtime knows in other letter case', 'europe/amsterdam'],
    ['an unknown name', 'Mars/Olympus_Mons'],
    ['an empty name', ''],
    ['a name with spaces', 'Europe/ Amsterdam'],
    ['a name that is too long', `Europe/${'A'.repeat(64)}`],
    ['a number', 42],
    ['nothing', null],
  ])('refuses %s', (_case, value) => {
    expect(isTimeZone(value)).toBe(false);
  });
});

describe('timeZoneOffset', () => {
  it.each([
    ['UTC', new Date('2026-07-01T12:00:00Z'), 'UTC'],
    ['Europe/Amsterdam', new Date('2026-07-01T12:00:00Z'), 'UTC+02:00'],
    ['Europe/Amsterdam', new Date('2026-12-01T12:00:00Z'), 'UTC+01:00'],
    ['America/New_York', new Date('2026-12-01T12:00:00Z'), 'UTC-05:00'],
    ['Asia/Kolkata', new Date('2026-12-01T12:00:00Z'), 'UTC+05:30'],
  ])('gives %s at %s as %s', (zone, at, expected) => {
    expect(timeZoneOffset(zone, at).replace('−', '-')).toBe(expected);
  });
});

describe('timeZoneOptions', () => {
  const at = new Date('2026-12-01T12:00:00Z');

  it('lists UTC and every zone the runtime knows, by name, with its offset', () => {
    const options = timeZoneOptions(at);

    expect(options.find(({ value }) => value === 'UTC')?.label).toBe('UTC');
    expect(options.find(({ value }) => value === 'Europe/London')?.label).toBe(
      'Europe/London (UTC)',
    );
    expect(options.find(({ value }) => value === 'Europe/Amsterdam')?.label).toBe(
      'Europe/Amsterdam (UTC+01:00)',
    );
    const names = options.map(({ value }) => value);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(new Set(names).size).toBe(names.length);
  });

  it('adds the chosen zone when the runtime lists it by another name', () => {
    const chosen = timeZoneOptions(at, 'Asia/Kolkata').filter(
      ({ value }) => value === 'Asia/Kolkata',
    );

    expect(chosen).toHaveLength(1);
  });
});
