/**
 * @file Tests for reading a job's schedule as words can say it, and
 * showing any other expression as it's written.
 */
import { describe, expect, it } from 'vitest';

import describeSchedule, { nextRunOf } from './job-schedule';

describe('describeSchedule', () => {
  it('reads every few minutes', () => {
    expect(describeSchedule('*/5 * * * *')).toEqual({ kind: 'minutes', minutes: 5 });
    expect(describeSchedule('* * * * *')).toEqual({ kind: 'minutes', minutes: 1 });
  });

  it('reads every hour at a minute', () => {
    expect(describeSchedule('0 * * * *')).toEqual({ kind: 'hourly', minute: 0 });
    expect(describeSchedule('10 * * * *')).toEqual({ kind: 'hourly', minute: 10 });
  });

  it('reads every day at a time', () => {
    expect(describeSchedule('15 3 * * *')).toEqual({ kind: 'daily', hour: 3, minute: 15 });
  });

  it('shows anything else as it’s written', () => {
    [
      '*/7 * * * *',
      '0 9 * * 1-5',
      '0,30 * * * *',
      '0 */2 * * *',
      '61 * * * *',
      '0 24 * * *',
      '0 3 1 * *',
      '* * * *',
    ].forEach((expression) => {
      expect(describeSchedule(expression)).toEqual({ kind: 'cron', expression });
    });
  });
});

describe('nextRunOf', () => {
  const now = new Date('2026-11-21T10:20:30Z');

  it('gives the next run of an hourly schedule, this hour or the next', () => {
    expect(nextRunOf({ kind: 'hourly', minute: 45 }, now)).toEqual(
      new Date('2026-11-21T10:45:00Z'),
    );
    expect(nextRunOf({ kind: 'hourly', minute: 10 }, now)).toEqual(
      new Date('2026-11-21T11:10:00Z'),
    );
  });

  it('gives the next run of a daily schedule, today or tomorrow, in UTC', () => {
    expect(nextRunOf({ kind: 'daily', hour: 22, minute: 0 }, now)).toEqual(
      new Date('2026-11-21T22:00:00Z'),
    );
    expect(nextRunOf({ kind: 'daily', hour: 3, minute: 15 }, now)).toEqual(
      new Date('2026-11-22T03:15:00Z'),
    );
  });

  it('never gives the moment it looks from', () => {
    expect(
      nextRunOf({ kind: 'daily', hour: 3, minute: 15 }, new Date('2026-11-21T03:15:00Z')),
    ).toEqual(new Date('2026-11-22T03:15:00Z'));
  });
});
