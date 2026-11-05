/**
 * @file The metadata of the 404 page, for that page and for pages someone may
 * not see (they get the 404 page, so its title too). Pure and client-safe.
 */
import type { Metadata } from 'next';

/** The 404 page's title, also for pages the user may not see. */
export const NOT_FOUND_TITLE = 'Not found · Adiutor';

/**
 * Metadata for a page or layout the user may not see. `absolute` ignores a
 * parent's title template (a company page's would add the company's name),
 * and `template` (without `%s`) gives every page below a layout the same
 * title, whatever title they set themselves.
 */
export const NOT_FOUND_METADATA = {
  title: { absolute: NOT_FOUND_TITLE, template: NOT_FOUND_TITLE },
} as const satisfies Metadata;
