/**
 * @file A request's number as people see and type it. Requests are numbered
 * in one series across Adiutor; the number is shown after a prefix the staff
 * choose ("AD-142"), which is only for display: addresses and searches go by
 * the digits, so changing the prefix breaks nothing. A search finds every
 * request whose number starts with the digits typed, so a number narrows the
 * list as it's typed, like a title does.
 */

/** The prefix request numbers are shown with until the staff choose their own. */
export const DEFAULT_REQUEST_PREFIX = 'AD';

/**
 * What a prefix looks like: one to five capital letters or digits, starting
 * with a letter (`REQUEST_PREFIX_MAX_LENGTH` in `input-rules.ts` is its
 * length).
 */
export const REQUEST_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,4}$/;

/** A request number in an address: digits only, at most nine, never starting with 0. */
const NUMBER_SEGMENT = /^[1-9]\d{0,8}$/;

/**
 * A request number as someone types it into a search field: the digits, on
 * their own or after "#" or a prefix ("142", "#142", "AD-142", "ad 142",
 * "AD142"). Any prefix will do, so a number written with an earlier prefix
 * still finds its request.
 */
const NUMBER_IN_SEARCH = /^#?\s*(?:[a-z][a-z0-9]{0,4}[-\s]+|[a-z]{1,5})?([1-9]\d{0,8})$/i;

/**
 * Writes a request's number as people see it.
 *
 * @param prefix - The staff's prefix, e.g. "AD".
 * @param number - The request's number.
 * @returns The number with its prefix, e.g. "AD-142".
 */
export function formatRequestNumber(prefix: string, number: number): string {
  return `${prefix}-${number}`;
}

/**
 * Reads the request number in an address (`/requests/142`). Strict, so
 * nothing that isn't a number a request can have reaches the database.
 *
 * @param segment - The part of the address after `/requests/`.
 * @returns The number, or `null` when it isn't one.
 */
export function parseRequestNumber(segment: string): number | null {
  return NUMBER_SEGMENT.test(segment) ? Number(segment) : null;
}

/**
 * Finds the start of a request number in what someone searched for, if what
 * they typed is one: its digits, without "#" or a prefix. "AD-1" gives "1",
 * which the numbers 1, 10 to 19, 100 to 199 and so on start with.
 *
 * @param term - The search term.
 * @returns The digits (1 to 9 of them, never starting with 0), or `null` when the term is
 *   something else.
 */
export function requestNumberStartInSearch(term: string): string | null {
  return NUMBER_IN_SEARCH.exec(term.trim())?.[1] ?? null;
}

/**
 * A request's address.
 *
 * @param number - The request's number.
 * @returns The path of its page.
 */
export function requestPath(number: number): string {
  return `/requests/${number}`;
}
