/**
 * @file Tests for reading a day range from two date fields: UTC days with
 * both days included, either side optional, and invalid or reversed dates
 * refused with the problem.
 */
import { describe, expect, it } from 'vitest';

import { parseDayRange } from './day-range';

describe('parseDayRange', () => {
  it('includes the whole of both days, in UTC', () => {
    expect(parseDayRange('2026-11-01', '2026-11-03')).toEqual({
      ok: true,
      range: {
        start: new Date('2026-11-01T00:00:00.000Z'),
        end: new Date('2026-11-04T00:00:00.000Z'),
      },
    });
  });

  it('takes one day as from and to', () => {
    expect(parseDayRange('2026-11-03', '2026-11-03')).toEqual({
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
    expect(parseDayRange(from, to)).toEqual({ ok: true, range });
  });

  it.each([
    ['2026-02-31', undefined],
    [undefined, '2026-13-01'],
    ['3 Nov 2026', undefined],
    ['2026-11-3', undefined],
  ])('refuses a date that isn’t a real day (%j, %j), limiting nothing', (from, to) => {
    expect(parseDayRange(from, to)).toEqual({
      ok: false,
      problem: 'invalidDay',
      range: { start: null, end: null },
    });
  });

  it('refuses a from date after the to date', () => {
    expect(parseDayRange('2026-11-04', '2026-11-03')).toEqual({
      ok: false,
      problem: 'fromAfterTo',
      range: { start: null, end: null },
    });
  });
});
