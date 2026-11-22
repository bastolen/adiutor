/**
 * @file Tests for the time zone rules: which names Adiutor accepts, how an
 * offset is written, and the list people pick from.
 */
import { describe, expect, it } from 'vitest';

import {
  compareTimeZoneOptions,
  isTimeZone,
  TIME_ZONE_REGIONS,
  timeZoneOffset,
  timeZoneOption,
  timeZoneOptions,
} from './time-zones';

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

describe('timeZoneOption', () => {
  const at = new Date('2026-12-01T12:00:00Z');

  it('names a zone by its place, with its region and its offset now', () => {
    expect(timeZoneOption('Europe/Amsterdam', at)).toEqual({
      value: 'Europe/Amsterdam',
      label: 'Amsterdam (UTC+01:00)',
      region: 'Europe',
    });
    expect(timeZoneOption('Europe/London', at).label).toBe('London (UTC)');
  });

  it('writes a place with spaces, the smallest place first', () => {
    // The minus sign of an offset is written as the runtime writes it.
    expect(timeZoneOption('America/New_York', at)).toEqual({
      value: 'America/New_York',
      label: `New York (${timeZoneOffset('America/New_York', at)})`,
      region: 'America',
    });
    expect(timeZoneOption('America/Argentina/Rio_Gallegos', at).label).toBe(
      `Rio Gallegos, Argentina (${timeZoneOffset('America/Argentina/Rio_Gallegos', at)})`,
    );
  });

  it('lists UTC by its name, under no region', () => {
    expect(timeZoneOption('UTC', at)).toEqual({ value: 'UTC', label: 'UTC', region: null });
  });

  it('lists a zone of another area under the other zones, by its whole name', () => {
    expect(timeZoneOption('Etc/GMT+5', at)).toEqual({
      value: 'Etc/GMT+5',
      label: `Etc/GMT+5 (${timeZoneOffset('Etc/GMT+5', at)})`,
      region: 'Other',
    });
  });
});

describe('timeZoneOptions', () => {
  const at = new Date('2026-12-01T12:00:00Z');

  it('lists UTC first, then every zone the runtime knows by region and place', () => {
    const options = timeZoneOptions(at);

    expect(options[0]).toEqual({ value: 'UTC', label: 'UTC', region: null });
    expect(options.find(({ value }) => value === 'Europe/Amsterdam')?.label).toBe(
      'Amsterdam (UTC+01:00)',
    );
    expect(options).toEqual([...options].sort(compareTimeZoneOptions));
    // The regions come in their order, each in one piece.
    const regions = options.slice(1).map(({ region }) => region);
    expect([...new Set(regions)]).toEqual(
      TIME_ZONE_REGIONS.filter((region) => regions.includes(region)),
    );
    const names = options.map(({ value }) => value);
    expect(new Set(names).size).toBe(names.length);
  });

  it('adds the chosen zone when the runtime lists it by another name', () => {
    const chosen = timeZoneOptions(at, 'Asia/Kolkata').filter(
      ({ value }) => value === 'Asia/Kolkata',
    );

    expect(chosen).toEqual([
      { value: 'Asia/Kolkata', label: 'Kolkata (UTC+05:30)', region: 'Asia' },
    ]);
  });
});
