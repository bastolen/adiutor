/**
 * @file Formatting for dates, times, durations and lists of names shown in
 * the UI and in emails, in the reader's language and time zone. Server
 * Components pass the request's locale and zone (`getLocale()` and
 * `getTimeZone()`, or `useLocale()` and `useTimeZone()`), client components
 * the provider's (`useLocale()` and `useTimeZone()`), and emails the
 * recipient's (`recipientLocale`, `recipientTimeZone`). A page shows a time
 * without its zone (it's the reader's own); an email or a text that's copied
 * names it (`zoneName`), since it's read elsewhere. See docs/i18n.md,
 * "Formatting".
 */
import type { Locale } from './i18n/locales';

/** Date format: day, short month, year (e.g. "Oct 23, 2026" or "23 okt 2026"). */
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

/**
 * Date and time format (e.g. "Oct 23, 2026, 2:05 PM"). Separate fields
 * rather than `dateStyle`, which can't be combined with `timeZoneName`.
 */
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: 'numeric',
  minute: '2-digit',
};

/** Time format, for a moment later today (e.g. "2:05 PM" or "14:05"). */
const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
};

/** How a time is shown besides its language and zone. */
export interface TimeFormatOptions {
  /**
   * Whether to name the zone ("2:05 PM CET"): for emails and texts that are
   * copied, which are read elsewhere. Pages leave it out.
   */
  zoneName?: boolean;
}

/** The formatters made so far, by language, zone and kind, since creating one is slow. */
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The formatter of a kind of date or time, in a language and zone.
 *
 * @param kind - Which format: a date, a date and time, or a time.
 * @param locale - The reader's language.
 * @param timeZone - The reader's zone.
 * @param zoneName - Whether it names the zone.
 * @returns The formatter.
 */
function dateTimeFormat(
  kind: 'date' | 'dateTime' | 'time',
  locale: Locale,
  timeZone: string,
  zoneName = false,
): Intl.DateTimeFormat {
  const key = `${kind}|${locale}|${timeZone}|${String(zoneName)}`;
  let format = dateTimeFormats.get(key);
  if (!format) {
    const options = { date: DATE_OPTIONS, dateTime: DATE_TIME_OPTIONS, time: TIME_OPTIONS }[kind];
    format = new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone,
      ...(zoneName ? { timeZoneName: 'short' } : {}),
    });
    dateTimeFormats.set(key, format);
  }
  return format;
}

/** Relative time formatters, e.g. "5 minutes ago" or "yesterday", by language. */
const relativeFormats = new Map<Locale, Intl.RelativeTimeFormat>();

/**
 * Formats a date for display: the day it is in the reader's zone.
 *
 * @param date - The moment.
 * @param locale - The reader's language.
 * @param timeZone - The reader's zone.
 * @returns The formatted date, e.g. "Oct 23, 2026".
 */
export default function formatDate(date: Date, locale: Locale, timeZone: string): string {
  return dateTimeFormat('date', locale, timeZone).format(date);
}

/**
 * Formats a date and time for display, in the reader's zone.
 *
 * @param date - The moment.
 * @param locale - The reader's language.
 * @param timeZone - The reader's zone.
 * @param options - How to show it.
 * @param options.zoneName - Whether to name the zone (emails and copied text).
 * @returns The formatted moment, e.g. "Oct 23, 2026, 2:05 PM", or "…2:05 PM CET" with the zone.
 */
export function formatDateTime(
  date: Date,
  locale: Locale,
  timeZone: string,
  { zoneName = false }: TimeFormatOptions = {},
): string {
  return dateTimeFormat('dateTime', locale, timeZone, zoneName).format(date);
}

/**
 * Formats the time of a moment later today, in the reader's zone, e.g. when
 * signing in as someone ends (within the hour, so the date would only add
 * noise).
 *
 * @param date - The moment.
 * @param locale - The reader's language.
 * @param timeZone - The reader's zone.
 * @param options - How to show it.
 * @param options.zoneName - Whether to name the zone (emails and copied text).
 * @returns The formatted time, e.g. "2:05 PM", or "2:05 PM CET" with the zone.
 */
export function formatTime(
  date: Date,
  locale: Locale,
  timeZone: string,
  { zoneName = false }: TimeFormatOptions = {},
): string {
  return dateTimeFormat('time', locale, timeZone, zoneName).format(date);
}

/**
 * Whether two moments fall on the same day in a zone.
 *
 * @param a - One moment.
 * @param b - The other.
 * @param timeZone - The zone whose days count.
 * @returns Whether it's the same day there.
 */
export function isSameDay(a: Date, b: Date, timeZone: string): boolean {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return day.format(a) === day.format(b);
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
 * @param timeZone - The reader's zone, for the date after a week.
 * @param options - How to say it.
 * @param options.justNow - What to say for the last minute, e.g. "just now".
 * @param options.now - The current time. Defaults to now.
 * @returns The wording.
 */
export function formatRelative(
  date: Date,
  locale: Locale,
  timeZone: string,
  { justNow, now = new Date() }: { justNow: string; now?: Date },
): string {
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) {
    return justNow;
  }
  const unit = RELATIVE_UNITS.find(([, , until]) => seconds < until);
  if (!unit) {
    return formatDate(date, locale, timeZone);
  }
  const [name, length] = unit;
  const format =
    relativeFormats.get(locale) ?? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  relativeFormats.set(locale, format);
  return format.format(-Math.floor(seconds / length), name);
}

/** A minute, an hour and a day in milliseconds. */
const MINUTE = 60_000;

/** The units a duration is said in, with how many minutes each one is. */
const DURATION_UNITS = { minute: 1, hour: 60, day: 24 * 60 } as const;

/** A duration's unit. */
type DurationUnit = keyof typeof DURATION_UNITS;

/** Formatters of a number of minutes, hours or days ("2 hours"), per language and unit. */
const durationFormats = new Map<string, Intl.NumberFormat>();

/**
 * Formats how long something took, in whole minutes, hours or days: minutes
 * up to an hour, hours up to two days, days after that. Never less than a
 * minute.
 *
 * @param milliseconds - How long it took.
 * @param locale - The reader's language.
 * @returns E.g. "45 minutes", "2 hours", "3 days".
 */
export function formatDuration(milliseconds: number, locale: Locale): string {
  const minutes = Math.max(1, Math.round(milliseconds / MINUTE));
  let unit: DurationUnit = 'day';
  if (minutes < DURATION_UNITS.hour) {
    unit = 'minute';
  } else if (minutes < 2 * DURATION_UNITS.day) {
    unit = 'hour';
  }
  const key = `${locale}:${unit}`;
  const format =
    durationFormats.get(key) ??
    new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' });
  durationFormats.set(key, format);
  return format.format(Math.round(minutes / DURATION_UNITS[unit]));
}

/** List formats by locale, made once each. */
const listFormats = new Map<string, Intl.ListFormat>();

/**
 * Joins names into one list the way the reader's language does ("Sam and
 * Morgan", "Sam, Morgan and Robin"), to go into a sentence as one argument.
 *
 * @param items - The names, in the order to show them.
 * @param locale - The reader's language.
 * @returns The list, e.g. "Sam Support and Morgan Manager".
 */
export function formatList(items: readonly string[], locale: Locale): string {
  const format =
    listFormats.get(locale) ?? new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
  listFormats.set(locale, format);
  return format.format(items);
}
