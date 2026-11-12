/**
 * @file Formatting for dates and times shown in the UI and in emails, in
 * the reader's language. Times are in UTC and say so (`TIME_ZONE`), so
 * server and browser render the same text. Server Components pass the
 * request's locale (`getLocale()` or `useLocale()`), emails the recipient's.
 */
import type { Locale } from './i18n/locales';
import { TIME_ZONE } from './i18n/time-zone';

/** Date format: day, short month, year (e.g. "Oct 23, 2026" or "23 okt 2026"). */
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: TIME_ZONE,
};

/**
 * Date and time format with the zone (e.g. "Oct 23, 2026, 2:05 PM UTC").
 * Separate fields rather than `dateStyle`, which can't be combined with
 * `timeZoneName`.
 */
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

/** Time format with the zone, for a moment later today (e.g. "2:05 PM UTC" or "14:05 UTC"). */
const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
  timeZone: TIME_ZONE,
};

/**
 * Keeps one formatter per language and kind, since creating one is slow.
 *
 * @param create - Creates the formatter for a language.
 * @returns A function that returns the language's formatter.
 */
function perLocale<F>(create: (locale: Locale) => F): (locale: Locale) => F {
  const made = new Map<Locale, F>();
  return (locale) => {
    let formatter = made.get(locale);
    if (!formatter) {
      formatter = create(locale);
      made.set(locale, formatter);
    }
    return formatter;
  };
}

/** Date formatters. */
const dateFormat = perLocale((locale) => new Intl.DateTimeFormat(locale, DATE_OPTIONS));

/** Date and time formatters. */
const dateTimeFormat = perLocale((locale) => new Intl.DateTimeFormat(locale, DATE_TIME_OPTIONS));

/** Time formatters. */
const timeFormat = perLocale((locale) => new Intl.DateTimeFormat(locale, TIME_OPTIONS));

/** Relative time formatters, e.g. "5 minutes ago" or "yesterday". */
const relativeFormat = perLocale(
  (locale) => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
);

/**
 * Formats a date for display.
 *
 * @param date - The date.
 * @param locale - The reader's language.
 * @returns The formatted date, e.g. "Oct 23, 2026".
 */
export default function formatDate(date: Date, locale: Locale): string {
  return dateFormat(locale).format(date);
}

/**
 * Formats a date and time for display, in UTC.
 *
 * @param date - The moment.
 * @param locale - The reader's language.
 * @returns The formatted moment, e.g. "Oct 23, 2026, 2:05 PM UTC".
 */
export function formatDateTime(date: Date, locale: Locale): string {
  return dateTimeFormat(locale).format(date);
}

/**
 * Formats the time of a moment later today, in UTC, e.g. when signing in as
 * someone ends (within the hour, so the date would only add noise).
 *
 * @param date - The moment.
 * @param locale - The reader's language.
 * @returns The formatted time, e.g. "2:05 PM UTC".
 */
export function formatTime(date: Date, locale: Locale): string {
  return timeFormat(locale).format(date);
}

/** Units for {@link formatRelative}, each with its length in seconds and how long it's used. */
const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number, number][] = [
  ['minute', 60, 60 * 60],
  ['hour', 60 * 60, 24 * 60 * 60],
  ['day', 24 * 60 * 60, 7 * 24 * 60 * 60],
];

/**
 * Formats how long ago something happened: "just now" (the caller's
 * translation), "5 minutes ago", "3 hours ago", "yesterday", "4 days ago",
 * then the date.
 *
 * @param date - When it happened.
 * @param locale - The reader's language.
 * @param options - How to say it.
 * @param options.justNow - What to say for the last minute, e.g. "just now".
 * @param options.now - The current time. Defaults to now.
 * @returns The wording.
 */
export function formatRelative(
  date: Date,
  locale: Locale,
  { justNow, now = new Date() }: { justNow: string; now?: Date },
): string {
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) {
    return justNow;
  }
  const unit = RELATIVE_UNITS.find(([, , until]) => seconds < until);
  if (!unit) {
    return formatDate(date, locale);
  }
  const [name, length] = unit;
  return relativeFormat(locale).format(-Math.floor(seconds / length), name);
}
