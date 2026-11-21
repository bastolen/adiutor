/**
 * @file The anchors of a request's page that a link can point at: each entry
 * of its activity (`#entry-<entry ID>`) and its description. The emails about
 * a request link to the news they tell of with them, so the page opens there.
 * Both are section IDs (`isSectionId` in `src/lib/redirect.ts`), so signing
 * in on the way keeps them.
 */

/** The anchor of a request's description, the card at the top of its page. */
export const DESCRIPTION_ANCHOR = 'request-description';

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
