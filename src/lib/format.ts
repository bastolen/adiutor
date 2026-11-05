/**
 * @file Formatting for dates shown in the UI. Formatting happens on the
 * server with fixed settings, so server and browser render the same text.
 */

/** Date format: day, short month, year (e.g. "23 Oct 2026"), in UTC. */
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

/**
 * Formats a date for display.
 *
 * @param date - The date.
 * @returns The formatted date, e.g. "23 Oct 2026".
 */
export default function formatDate(date: Date): string {
  return dateFormat.format(date);
}

/** Date and time format, e.g. "23 Oct 2026, 14:05 UTC". */
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/**
 * Formats a date and time for display, in UTC.
 *
 * @param date - The moment.
 * @returns The formatted moment, e.g. "23 Oct 2026, 14:05 UTC".
 */
export function formatDateTime(date: Date): string {
  return `${dateTimeFormat.format(date)} UTC`;
}

/** Relative time wording, e.g. "5 minutes ago" or "yesterday". */
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** Units for {@link formatRelative}, each with its length in seconds and how long it's used. */
const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number, number][] = [
  ['minute', 60, 60 * 60],
  ['hour', 60 * 60, 24 * 60 * 60],
  ['day', 24 * 60 * 60, 7 * 24 * 60 * 60],
];

/**
 * Formats how long ago something happened: "just now", "5 minutes ago",
 * "3 hours ago", "yesterday", "4 days ago", then the date.
 *
 * @param date - When it happened.
 * @param now - The current time. Defaults to now.
 * @returns The wording.
 */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const unit = RELATIVE_UNITS.find(([, , until]) => seconds < until);
  if (!unit) {
    return formatDate(date);
  }
  const [name, length] = unit;
  return relativeFormat.format(-Math.floor(seconds / length), name);
}
