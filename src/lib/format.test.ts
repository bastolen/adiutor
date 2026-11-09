/**
 * @file Tests for date and number formatting in each language.
 */
import { describe, expect, it } from 'vitest';

import formatDate, { formatDateTime, formatNumber, formatRelative } from './format';

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

describe('formatNumber', () => {
  it.each([
    ['en-US', '12,345'],
    ['nl-NL', '12.345'],
    ['es-ES', '12.345'],
  ] as const)('groups digits in %s', (locale, expected) => {
    expect(formatNumber(12345, locale)).toBe(expected);
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
