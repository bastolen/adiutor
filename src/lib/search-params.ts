/**
 * @file A page's query string as Next.js passes it, and the one way to read a
 * value from it. Pure and client-safe.
 */

/** A page's query string, as Next.js passes it to the page. */
export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Reads a single value from the query string: a parameter given twice counts
 * as missing, so a crafted URL can't pick which copy wins.
 *
 * @param value - The parameter's value, e.g. `params.q`.
 * @returns The value, or `undefined`.
 */
export function searchParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
