/**
 * @file Tests for reading a day range from two date fields: the reader's days
 * with both days included, daylight saving too, either side optional, and
 * invalid or reversed dates refused with the problem.
 */
import { describe, expect, it } from 'vitest';

import { parseDayRange } from './day-range';

describe('parseDayRange', () => {
  it('includes the whole of both days', () => {
    expect(parseDayRange('2026-11-01', '2026-11-03', 'UTC')).toEqual({
      ok: true,
      range: {
        start: new Date('2026-11-01T00:00:00.000Z'),
        end: new Date('2026-11-04T00:00:00.000Z'),
      },
    });
  });

  it.each([
    ['Asia/Tokyo', '2026-11-18T15:00:00.000Z', '2026-11-19T15:00:00.000Z'],
    ['America/New_York', '2026-11-19T05:00:00.000Z', '2026-11-20T05:00:00.000Z'],
    ['Asia/Kolkata', '2026-11-18T18:30:00.000Z', '2026-11-19T18:30:00.000Z'],
  ])('starts and ends the days at midnight in %s', (timeZone, start, end) => {
    expect(parseDayRange('2026-11-19', '2026-11-19', timeZone)).toEqual({
      ok: true,
      range: { start: new Date(start), end: new Date(end) },
    });
  });

  it('gives a day its 23 or 25 hours when the clocks change', () => {
    // Amsterdam's clocks go forward on March 29, 2026, and back on October 25.
    expect(parseDayRange('2026-03-29', '2026-03-29', 'Europe/Amsterdam')).toEqual({
      ok: true,
      range: {
        start: new Date('2026-03-28T23:00:00.000Z'),
        end: new Date('2026-03-29T22:00:00.000Z'),
      },
    });
    expect(parseDayRange('2026-10-25', '2026-10-25', 'Europe/Amsterdam')).toEqual({
      ok: true,
      range: {
        start: new Date('2026-10-24T22:00:00.000Z'),
        end: new Date('2026-10-25T23:00:00.000Z'),
      },
    });
  });

  it('ends a range on the last day of a month or a year', () => {
    expect(parseDayRange(undefined, '2026-12-31', 'Asia/Tokyo')).toEqual({
      ok: true,
      range: { start: null, end: new Date('2026-12-31T15:00:00.000Z') },
    });
  });

  it('takes one day as from and to', () => {
    expect(parseDayRange('2026-11-03', '2026-11-03', 'UTC')).toEqual({
      ok: true,
      range: {
        start: new Date('2026-11-03T00:00:00.000Z'),
        end: new Date('2026-11-04T00:00:00.000Z'),
      },
    });
  });

  it.each([
    [undefined, undefined, { start: null, end: null }],
    ['2026-11-01', undefined, { start: new Date('2026-11-01T00:00:00.000Z'), end: null }],
    [undefined, '2026-11-01', { start: null, end: new Date('2026-11-02T00:00:00.000Z') }],
    ['', '', { start: null, end: null }],
  ])('leaves a side open when its date is empty (%j, %j)', (from, to, range) => {
    expect(parseDayRange(from, to, 'UTC')).toEqual({ ok: true, range });
  });

  it.each([
    ['2026-02-31', undefined],
    [undefined, '2026-13-01'],
    ['3 Nov 2026', undefined],
    ['2026-11-3', undefined],
  ])('refuses a date that isn’t a real day (%j, %j), limiting nothing', (from, to) => {
    expect(parseDayRange(from, to, 'UTC')).toEqual({
      ok: false,
      problem: 'invalidDay',
      range: { start: null, end: null },
    });
  });

  it('refuses a from date after the to date', () => {
    expect(parseDayRange('2026-11-04', '2026-11-03', 'UTC')).toEqual({
      ok: false,
      problem: 'fromAfterTo',
      range: { start: null, end: null },
    });
  });
});
