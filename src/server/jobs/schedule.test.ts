/**
 * @file Tests for reading a recurring job's schedule: the last and next
 * scheduled moments, whether a job is due (one catch-up run, however many
 * moments went by), and which schedules are valid.
 */
import { describe, expect, it } from 'vitest';

import { isDue, isValidSchedule, lastScheduledAt, nextScheduledAt } from './schedule';

/**
 * A moment on 12 November 2026, in UTC.
 *
 * @param time - The time of day, e.g. `'10:07:30'`.
 * @returns The moment.
 */
function at(time: string): Date {
  return new Date(`2026-11-12T${time}Z`);
}

describe('lastScheduledAt', () => {
  it('finds the latest scheduled moment before now', () => {
    expect(lastScheduledAt('*/5 * * * *', at('10:07:30'))).toEqual(at('10:05:00'));
    expect(lastScheduledAt('0 * * * *', at('10:07:30'))).toEqual(at('10:00:00'));
  });

  it('counts a moment that is exactly now', () => {
    expect(lastScheduledAt('*/5 * * * *', at('10:05:00'))).toEqual(at('10:05:00'));
  });

  it('reads the schedule in UTC', () => {
    expect(lastScheduledAt('15 3 * * *', at('10:00:00'))).toEqual(at('03:15:00'));
  });
});

describe('nextScheduledAt', () => {
  it('finds the first scheduled moment after now', () => {
    expect(nextScheduledAt('*/5 * * * *', at('10:07:30'))).toEqual(at('10:10:00'));
    expect(nextScheduledAt('10 * * * *', at('10:10:00'))).toEqual(at('11:10:00'));
  });
});

describe('isDue', () => {
  it('is due when the job never ran', () => {
    expect(isDue('15 3 * * *', null, at('10:00:00'))).toBe(true);
  });

  it('is due once a scheduled moment passed since the last start', () => {
    expect(isDue('0 * * * *', at('09:00:05'), at('10:00:30'))).toBe(true);
    expect(isDue('0 * * * *', at('10:00:05'), at('10:30:00'))).toBe(false);
  });

  it('is due once, not once per moment, after a long silence', () => {
    // Hours without a tick: one run at 10:07 covers them all.
    expect(isDue('*/5 * * * *', at('06:00:00'), at('10:07:00'))).toBe(true);
    expect(isDue('*/5 * * * *', at('10:07:00'), at('10:08:00'))).toBe(false);
  });
});

describe('isValidSchedule', () => {
  it('accepts cron expressions and refuses anything else', () => {
    expect(isValidSchedule('*/5 * * * *')).toBe(true);
    expect(isValidSchedule('0 6 1 * *')).toBe(true);
    expect(isValidSchedule('every hour')).toBe(false);
    expect(isValidSchedule('61 * * * *')).toBe(false);
    // Seconds, or fields left out, aren't schedules.
    expect(isValidSchedule('0 */5 * * * *')).toBe(false);
    expect(isValidSchedule('* * * *')).toBe(false);
  });
});
