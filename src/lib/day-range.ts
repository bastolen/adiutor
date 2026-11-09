/**
 * @file Turns a "from" and "to" date, as a date field sends them
 * (`yyyy-mm-dd`), into the times a query needs. Days are UTC days, as the app
 * shows times in UTC; both days are included.
 */

/** A range of whole days, as times. */
export interface DayRange {
  /** The first moment of the "from" day, if one was given. */
  start: Date | null;
  /** The first moment after the "to" day (so the whole day is included), if one was given. */
  end: Date | null;
}

/**
 * Why a day range can't be used: a date that isn't a real day, or a "from"
 * after the "to". The page that shows it words it in the reader's language.
 */
export type DayRangeProblem = 'invalidDay' | 'fromAfterTo';

/** What {@link parseDayRange} found. */
export type DayRangeResult =
  { ok: true; range: DayRange } | { ok: false; problem: DayRangeProblem; range: DayRange };

/** A date as date fields send it. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reads one `yyyy-mm-dd` date as the start of that UTC day.
 *
 * @param value - The date.
 * @returns The day's first moment, or `null` when it isn't a real date.
 */
function startOfDay(value: string): Date | null {
  const match = DAY.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  // `Date.UTC` rolls 31 February over into March: only real dates count.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
    ? date
    : null;
}

/**
 * Reads a day range from two optional dates. An empty date means no limit on
 * that side; an invalid one, or a "from" after the "to", is refused with
 * the problem for the page to explain, and then nothing is limited.
 *
 * @param from - The first day (`yyyy-mm-dd`), if any.
 * @param to - The last day (`yyyy-mm-dd`), if any.
 * @returns The range, or why it can't be used.
 */
export function parseDayRange(from: string | undefined, to: string | undefined): DayRangeResult {
  const none: DayRange = { start: null, end: null };
  const start = from ? startOfDay(from) : null;
  const lastDay = to ? startOfDay(to) : null;
  if ((from && !start) || (to && !lastDay)) {
    return { ok: false, problem: 'invalidDay', range: none };
  }
  if (start && lastDay && start > lastDay) {
    return { ok: false, problem: 'fromAfterTo', range: none };
  }
  return {
    ok: true,
    range: { start, end: lastDay ? new Date(lastDay.getTime() + DAY_MS) : null },
  };
}
