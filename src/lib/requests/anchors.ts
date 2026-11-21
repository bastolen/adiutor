/**
 * @file The anchors of a request's page that a link can point at: each entry
 * of its activity (`#entry-<entry ID>`) and its description. The emails about
 * a request link to the news they tell of with them, so the page opens there.
 * Both are section IDs (`isSectionId` in `src/lib/redirect.ts`), so signing
 * in on the way keeps them. A link to an entry also names it in its query
 * (`?entry=<entry ID>`): the anchor never reaches the server and the query
 * does, so the page can show that entry whatever the reader's activity filter.
 */
import { requestPath } from './number';

/** The anchor of a request's description, the card at the top of its page. */
export const DESCRIPTION_ANCHOR = 'request-description';

/** The query parameter that names the entry an address points at: `?entry=<entry ID>`. */
export const ENTRY_PARAM = 'entry';

/** What every entry's anchor starts with. */
const ENTRY_ANCHOR_PREFIX = 'entry-';

/** An entry's ID as its anchor holds it: a UUID, in lowercase. */
const ENTRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The anchor of an entry of a request's activity.
 *
 * @param entryId - The entry's ID.
 * @returns The anchor, e.g. `entry-019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b`.
 */
export function entryAnchor(entryId: string): string {
  return `${ENTRY_ANCHOR_PREFIX}${entryId}`;
}

/**
 * Checks whether an anchor names an entry of a request's activity.
 *
 * @param anchor - The anchor, without its `#`, or `null`.
 * @returns Whether it's `entry-` followed by an entry's ID.
 */
export function isEntryAnchor(anchor: string | null): anchor is string {
  return (
    anchor !== null &&
    anchor.startsWith(ENTRY_ANCHOR_PREFIX) &&
    ENTRY_ID.test(anchor.slice(ENTRY_ANCHOR_PREFIX.length))
  );
}

/**
 * Checks whether a value is an entry's ID (a UUID, in lowercase), as an
 * address may name it (`?entry=<ID>`).
 *
 * @param value - The value, e.g. a query parameter.
 * @returns Whether it is one.
 */
export function isEntryId(value: unknown): value is string {
  return typeof value === 'string' && ENTRY_ID.test(value);
}

/**
 * The ID of the entry an anchor names.
 *
 * @param anchor - The anchor, or `null`.
 * @returns The entry's ID, or `null` for any other anchor.
 */
export function entryIdOf(anchor: string | null): string | null {
  return isEntryAnchor(anchor) ? anchor.slice(ENTRY_ANCHOR_PREFIX.length) : null;
}

/**
 * The address of a request's page, naming the entry a link points at in its
 * query (`?entry=<ID>`), so the page shows it whatever the reader's activity
 * filter. Anything that isn't an entry's ID is left out.
 *
 * @param number - The request's number.
 * @param entryId - The entry's ID, or `null` for none.
 * @returns The path, e.g. `/requests/142?entry=<ID>`.
 */
export function requestPathWithEntry(number: number, entryId: string | null | undefined): string {
  return isEntryId(entryId)
    ? `${requestPath(number)}?${ENTRY_PARAM}=${entryId}`
    : requestPath(number);
}

/**
 * The address of a request's page opened at an anchor: an entry is named in
 * the query too (`?entry=<ID>#entry-<ID>`), the description by its anchor only.
 *
 * @param number - The request's number.
 * @param anchor - The anchor (`entryAnchor`, `DESCRIPTION_ANCHOR`), or `null` for the top.
 * @returns The path, e.g. `/requests/142?entry=<ID>#entry-<ID>`.
 */
export function requestPathAt(number: number, anchor: string | null): string {
  const path = requestPathWithEntry(number, entryIdOf(anchor));
  return anchor === null ? path : `${path}#${anchor}`;
}
