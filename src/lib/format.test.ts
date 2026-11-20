/**
 * @file Tests for date and number formatting in each language.
 */
import { describe, expect, it } from 'vitest';

import formatDate, {
  formatDateTime,
  formatDuration,
  formatList,
  formatRelative,
  formatTime,
} from './format';

const NOW = new Date('2026-10-23T12:00:00Z');

/**
 * A moment some seconds before {@link NOW}.
 *
 * @param seconds - How long before.
 * @returns The moment.
 */
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe('formatDate', () => {
  it.each([
    ['en-US', 'Oct 23, 2026'],
    ['nl-NL', '23 okt 2026'],
    ['es-ES', '23 oct 2026'],
  ] as const)('formats in UTC in %s', (locale, expected) => {
    expect(formatDate(new Date('2026-10-23T23:30:00Z'), locale)).toBe(expected);
  });
});

describe('formatDateTime', () => {
  it.each([
    ['en-US', 'Oct 23, 2026, 2:05 PM UTC'],
    ['nl-NL', '23 okt 2026, 14:05 UTC'],
    ['es-ES', '23 oct 2026, 14:05 UTC'],
  ] as const)('includes the time and zone in %s', (locale, expected) => {
    expect(formatDateTime(new Date('2026-10-23T14:05:00Z'), locale)).toBe(expected);
  });
});

describe('formatTime', () => {
  it.each([
    ['en-US', '2:05 PM UTC'],
    ['nl-NL', '14:05 UTC'],
    ['es-ES', '14:05 UTC'],
  ] as const)('gives the time and zone without the date in %s', (locale, expected) => {
    expect(formatTime(new Date('2026-10-23T14:05:00Z'), locale)).toBe(expected);
  });
});

describe('formatRelative', () => {
  it.each([
    [10, 'just now'],
    [5 * 60, '5 minutes ago'],
    [3 * 60 * 60, '3 hours ago'],
    [24 * 60 * 60, 'yesterday'],
    [4 * 24 * 60 * 60, '4 days ago'],
    [30 * 24 * 60 * 60, 'Sep 23, 2026'],
  ])('describes %i seconds ago as "%s"', (seconds, expected) => {
    expect(formatRelative(ago(seconds), 'en-US', { justNow: 'just now', now: NOW })).toBe(expected);
  });

  it.each([
    ['nl-NL', '5 minuten geleden', 'gisteren'],
    ['es-ES', 'hace 5 minutos', 'ayer'],
  ] as const)('speaks %s', (locale, minutes, yesterday) => {
    expect(formatRelative(ago(5 * 60), locale, { justNow: '', now: NOW })).toBe(minutes);
    expect(formatRelative(ago(24 * 60 * 60), locale, { justNow: '', now: NOW })).toBe(yesterday);
  });

  it('treats future times as now', () => {
    expect(formatRelative(ago(-30), 'en-US', { justNow: 'just now', now: NOW })).toBe('just now');
  });
});

describe('formatDuration', () => {
  /** A minute in milliseconds. */
  const MINUTE = 60_000;

  it.each([
    [0, '1 minute'],
    [20_000, '1 minute'],
    [45 * MINUTE, '45 minutes'],
    [59 * MINUTE, '59 minutes'],
    [60 * MINUTE, '1 hour'],
    [150 * MINUTE, '3 hours'],
    [47 * 60 * MINUTE, '47 hours'],
    [48 * 60 * MINUTE, '2 days'],
    [10 * 24 * 60 * MINUTE, '10 days'],
  ])('says %i milliseconds as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds, 'en-US')).toBe(expected);
  });

  it.each([
    ['nl-NL', '45 minuten', '2 uur', '3 dagen'],
    ['es-ES', '45 minutos', '2 horas', '3 días'],
  ] as const)('speaks %s', (locale, minutes, hours, days) => {
    expect(formatDuration(45 * MINUTE, locale)).toBe(minutes);
    expect(formatDuration(120 * MINUTE, locale)).toBe(hours);
    expect(formatDuration(3 * 24 * 60 * MINUTE, locale)).toBe(days);
  });
});

describe('formatList', () => {
  it.each([
    ['en-US', 'Sam Support, Morgan Manager, and Robin Admin'],
    ['nl-NL', 'Sam Support, Morgan Manager en Robin Admin'],
    ['es-ES', 'Sam Support, Morgan Manager y Robin Admin'],
  ] as const)('joins names the way %s does', (locale, expected) => {
    expect(formatList(['Sam Support', 'Morgan Manager', 'Robin Admin'], locale)).toBe(expected);
  });

  it('gives one name as it is', () => {
    expect(formatList(['Sam Support'], 'en-US')).toBe('Sam Support');
  });
});
