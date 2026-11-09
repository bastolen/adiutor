/**
 * @file The notes a page shows for `?notice=<code>` after users changed their
 * own access and lost the page they did it on: stepping down from staff
 * Admin, leaving the staff, leaving a company, or stepping down in one. The
 * actions in `src/app/(app)/_people/` send them there (`withAccessNotice`)
 * instead of to that page's 404, and `AccessNotice` shows the note
 * (`common.accessNotice`, since the dashboard and company pages show it).
 */

/**
 * The notice codes, each with a note in `common.accessNotice`:
 * - `stepped-down`: a staff Admin gave themselves a lower staff role.
 * - `left-staff`: someone took themselves off the staff.
 * - `left-company`: a member removed themselves from a company they can no longer see.
 * - `company-stepped-down`: a company Admin gave themselves a role that doesn't manage members.
 *
 * Only these codes are shown: the address bar is the user's to change.
 */
export const ACCESS_NOTICE_CODES = [
  'stepped-down',
  'left-staff',
  'left-company',
  'company-stepped-down',
] as const;

/** A known notice code. */
export type AccessNoticeCode = (typeof ACCESS_NOTICE_CODES)[number];

/**
 * Builds the address of a page with a notice.
 *
 * @param path - The page, e.g. `/dashboard`.
 * @param code - The notice.
 * @returns The page's address with `?notice=<code>`.
 */
export function withAccessNotice(path: string, code: AccessNoticeCode): string {
  return `${path}?notice=${code}`;
}

/**
 * Reads a notice code.
 *
 * @param code - The `notice` query parameter, if any.
 * @returns The code, or `null` for none or an unknown one.
 */
export function getAccessNotice(code: string | null | undefined): AccessNoticeCode | null {
  return ACCESS_NOTICE_CODES.find((known) => known === code) ?? null;
}
