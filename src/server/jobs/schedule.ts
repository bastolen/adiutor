/**
 * @file Reading a recurring job's schedule: a cron expression in UTC (read
 * with `cron-parser`), for when it last should have run, when it runs next
 * and whether it's due.
 */
import { CronExpressionParser } from 'cron-parser';

/** How many fields a schedule has: minute, hour, day of the month, month and day of the week. */
const SCHEDULE_FIELDS = 5;

/**
 * Reads a schedule, counting from a moment.
 *
 * @param schedule - The cron expression.
 * @param from - The moment to count from.
 * @returns The parsed expression.
 * @throws {Error} When it isn't a cron expression of five fields.
 */
function parse(schedule: string, from: Date) {
  // cron-parser also takes seconds, and fills in missing fields; a schedule names all five.
  if (schedule.trim().split(/\s+/).length !== SCHEDULE_FIELDS) {
    throw new Error(`A schedule has ${SCHEDULE_FIELDS} fields: "${schedule}"`);
  }
  return CronExpressionParser.parse(schedule, { currentDate: from, tz: 'UTC' });
}

/**
 * The latest moment the schedule names, at or before `now`.
 *
 * @param schedule - The cron expression.
 * @param now - The moment to look back from.
 * @returns That moment.
 */
export function lastScheduledAt(schedule: string, now: Date): Date {
  // `prev()` looks strictly before the moment; one millisecond later includes `now` itself.
  return parse(schedule, new Date(now.getTime() + 1))
    .prev()
    .toDate();
}

/**
 * The first moment the schedule names after `now`.
 *
 * @param schedule - The cron expression.
 * @param now - The moment to look ahead from.
 * @returns That moment.
 */
export function nextScheduledAt(schedule: string, now: Date): Date {
  return parse(schedule, now).next().toDate();
}

/**
 * Whether a job is due: it never ran, or the schedule named a moment since
 * its last run started. However many moments went by (say, while nothing
 * ticked), that's one run, not one per moment.
 *
 * @param schedule - The cron expression.
 * @param lastStartedAt - When its last run started, or `null` if it never ran.
 * @param now - The current moment.
 * @returns Whether it's due.
 */
export function isDue(schedule: string, lastStartedAt: Date | null, now: Date): boolean {
  return lastStartedAt === null || lastScheduledAt(schedule, now) > lastStartedAt;
}

/**
 * Checks that a schedule is a cron expression that can be read.
 *
 * @param schedule - The cron expression.
 * @returns Whether it's valid.
 */
export function isValidSchedule(schedule: string): boolean {
  try {
    parse(schedule, new Date());
    return true;
  } catch {
    return false;
  }
}
