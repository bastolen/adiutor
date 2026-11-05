/**
 * @file Tests for date formatting.
 */
import { describe, expect, it } from 'vitest';

import formatDate, { formatDateTime, formatRelative } from './format';

const NOW = new Date('2026-10-23T12:00:00Z');

/**
 * A moment some seconds before {@link NOW}.
 *
 * @param seconds - How long before.
 * @returns The moment.
 */
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe('formatDate', () => {
  it('formats in UTC', () => {
    expect(formatDate(new Date('2026-10-23T23:30:00Z'))).toBe('23 Oct 2026');
  });
});

describe('formatDateTime', () => {
  it('includes the time and zone', () => {
    expect(formatDateTime(new Date('2026-10-23T14:05:00Z'))).toBe('23 Oct 2026, 14:05 UTC');
  });
});

describe('formatRelative', () => {
  it.each([
    [10, 'just now'],
    [5 * 60, '5 minutes ago'],
    [3 * 60 * 60, '3 hours ago'],
    [24 * 60 * 60, 'yesterday'],
    [4 * 24 * 60 * 60, '4 days ago'],
    [30 * 24 * 60 * 60, '23 Sept 2026'],
  ])('describes %i seconds ago as "%s"', (seconds, expected) => {
    expect(formatRelative(ago(seconds), NOW)).toBe(expected);
  });

  it('treats future times as now', () => {
    expect(formatRelative(ago(-30), NOW)).toBe('just now');
  });
});
