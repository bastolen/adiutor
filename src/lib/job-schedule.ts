/**
 * @file Reads a recurring job's schedule (a cron expression in UTC, see
 * docs/jobs.md) as one of the patterns the Jobs page puts in words: every few
 * minutes, every hour at a minute, or every day at a time. Other expressions
 * are shown as they're written.
 */

/** A schedule as the Jobs page words it (`admin.jobs.schedule`). */
export type ScheduleWords =
  /** Every `minutes` minutes, from the hour (`*\/5 * * * *`). */
  | { kind: 'minutes'; minutes: number }
  /** Every hour at `minute` past (`10 * * * *`). */
  | { kind: 'hourly'; minute: number }
  /** Every day at `hour`:`minute` UTC (`15 3 * * *`). */
  | { kind: 'daily'; hour: number; minute: number }
  /** Anything else, shown as the expression. */
  | { kind: 'cron'; expression: string };

/**
 * Reads a field of a cron expression as a plain number within a range.
 *
 * @param field - The field, e.g. `15`.
 * @param max - The highest value it may have.
 * @returns The number, or `null` when it's anything else (a list, a range, a step, a star).
 */
function plainNumber(field: string, max: number): number | null {
  if (!/^\d{1,2}$/.test(field)) {
    return null;
  }
  const value = Number(field);
  return value <= max ? value : null;
}

/**
 * Reads a schedule as words can say it.
 *
 * @param expression - The cron expression, five fields in UTC.
 * @returns The pattern it follows, or `cron` with the expression.
 */
export default function describeSchedule(expression: string): ScheduleWords {
  const fields = expression.trim().split(/\s+/);
  const [minute = '', hour = '', ...rest] = fields;
  if (fields.length !== 5 || rest.some((field) => field !== '*')) {
    return { kind: 'cron', expression };
  }
  const step = /^\*\/(\d{1,2})$/.exec(minute)?.[1];
  if (hour === '*' && (minute === '*' || step)) {
    const minutes = minute === '*' ? 1 : Number(step);
    // A step that doesn't divide the hour restarts at every hour, so it isn't "every N minutes".
    if (minutes >= 1 && minutes < 60 && 60 % minutes === 0) {
      return { kind: 'minutes', minutes };
    }
  }
  const atMinute = plainNumber(minute, 59);
  if (atMinute !== null && hour === '*') {
    return { kind: 'hourly', minute: atMinute };
  }
  const atHour = plainNumber(hour, 23);
  if (atMinute !== null && atHour !== null) {
    return { kind: 'daily', hour: atHour, minute: atMinute };
  }
  return { kind: 'cron', expression };
}
