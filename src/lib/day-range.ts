/**
 * @file Turns a "from" and "to" date, as a date field sends them
 * (`yyyy-mm-dd`), into the times a query needs. Days are the reader's days:
 * each starts at midnight in their time zone, so a day can be 23 or 25 hours
 * long when the clocks change. Both days are included.
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

/** A date's year, month (0 to 11) and day of the month. */
interface DayParts {
  /** The year. */
  year: number;
  /** The month, 0 to 11. */
  month: number;
  /** The day of the month. */
  day: number;
}

/**
 * A date as a number that grows with it, to compare dates before any zone.
 *
 * @param parts - The date.
 * @returns The number.
 */
function dayKey(parts: DayParts): number {
  return Date.UTC(parts.year, parts.month, parts.day);
}

/**
 * Reads one `yyyy-mm-dd` date as its year, month (0 to 11) and day.
 *
 * @param value - The date.
 * @returns Its parts, or `null` when it isn't a real date.
 */
function dayParts(value: string): DayParts | null {
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
    ? { year, month, day }
    : null;
}

/**
 * How far a zone's clock is ahead of UTC at a moment, in milliseconds
 * (negative when it's behind).
 *
 * @param at - The moment.
 * @param timeZone - The zone.
 * @returns The offset.
 */
function offsetAt(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(at)
      .map(({ type, value }) => [type, Number(value)]),
  );
  const asIfUtc = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The first moment of a day in a zone: its midnight there, or, in the rare
 * zones whose clocks skip midnight, the first moment after.
 *
 * @param year - The year.
 * @param month - The month, 0 to 11 (13 rolls over into the next year).
 * @param day - The day of the month (one past its last rolls over).
 * @param timeZone - The zone.
 * @returns The moment.
 */
function startOfDayIn(year: number, month: number, day: number, timeZone: string): Date {
  const midnightUtc = Date.UTC(year, month, day);
  // The zone's offset near that midnight, then again at the guess, in case the clocks changed between.
  const guess = midnightUtc - offsetAt(new Date(midnightUtc), timeZone);
  const settled = midnightUtc - offsetAt(new Date(guess), timeZone);
  return new Date(settled);
}

/**
 * Reads a day range from two optional dates, as days in the reader's zone.
 * An empty date means no limit on that side; an invalid one, or a "from"
 * after the "to", is refused with the problem for the page to explain, and
 * then nothing is limited.
 *
 * @param from - The first day (`yyyy-mm-dd`), if any.
 * @param to - The last day (`yyyy-mm-dd`), if any.
 * @param timeZone - The reader's zone, whose midnights start and end the days.
 * @returns The range, or why it can't be used.
 */
export function parseDayRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): DayRangeResult {
  const none: DayRange = { start: null, end: null };
  const first = from ? dayParts(from) : null;
  const last = to ? dayParts(to) : null;
  if ((from && !first) || (to && !last)) {
    return { ok: false, problem: 'invalidDay', range: none };
  }
  // Compared as dates, before any zone: a "from" after the "to" is that wherever you are.
  if (first && last && dayKey(first) > dayKey(last)) {
    return { ok: false, problem: 'fromAfterTo', range: none };
  }
  return {
    ok: true,
    range: {
      start: first ? startOfDayIn(first.year, first.month, first.day, timeZone) : null,
      // The first moment of the day after the "to" day, so the whole of it is included.
      end: last ? startOfDayIn(last.year, last.month, last.day + 1, timeZone) : null,
    },
  };
}
