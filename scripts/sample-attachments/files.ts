/**
 * @file What the sample attachments share (`scripts/sample-attachments/`):
 * the shape of a file and of what makes one, the zone their dates are in,
 * Alpha's old and new addresses, and how dates and times are written. Each
 * file is made from the time of the text it's attached to, so its dates fit
 * the request's history, and the same time always makes the same bytes.
 */

/** A file to attach: its name, with an extension on the allow-list, and its bytes. */
export interface SampleFile {
  /** Its name. */
  name: string;
  /** Its bytes. */
  bytes: Uint8Array<ArrayBuffer>;
}

/** Makes a file, given the time of the text it's attached to. */
export type SampleFileMaker = (at: Date) => Promise<SampleFile>;

/** The time zone the samples' dates and times are in (the dev data's default zone). */
export const ZONE = 'Europe/Amsterdam';

/** A minute in milliseconds. */
export const MINUTE = 60 * 1000;

/** A day in milliseconds. */
export const DAY = 24 * 60 * MINUTE;

/** Alpha's address before it moved, which the invoices still showed. */
export const OLD_ADDRESS = ['Keizersgracht 999', '1015 ZZ Amsterdam'];

/** Alpha's address since it moved. */
export const NEW_ADDRESS = ['Herengracht 999', '1017 ZZ Amsterdam'];

/**
 * A date as people write it, e.g. "9 November 2026".
 *
 * @param date - The date.
 * @returns The text.
 */
export function dayText(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: ZONE,
  });
}

/**
 * A time of day, e.g. "09:42".
 *
 * @param date - The moment.
 * @returns The text.
 */
export function timeText(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: ZONE });
}

/**
 * The year of a date, in the samples' zone.
 *
 * @param date - The date.
 * @returns The year, e.g. "2026".
 */
export function yearOf(date: Date): string {
  return date.toLocaleDateString('en-GB', { year: 'numeric', timeZone: ZONE });
}
