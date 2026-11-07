/**
 * @file The notes a page shows for `?notice=<code>` after users changed their
 * own access and lost the page they did it on: stepping down from staff
 * Admin, leaving the staff, leaving a company, or stepping down in one. The
 * actions in `src/app/(app)/_people/` send them there (`withAccessNotice`)
 * instead of to that page's 404, and `AccessNotice` shows the note.
 */

/** Each note by its code. Only these codes are shown: the address bar is the user's to change. */
export const ACCESS_NOTICES = {
  /** A staff Admin gave themselves a lower staff role. */
  'stepped-down':
    'You stepped down from staff Admin. Another staff Admin can give you the role back.',
  /** Someone took themselves off the staff. */
  'left-staff':
    'You’re no longer on the staff. Your account stays, and a staff Admin can invite you again.',
  /** A member removed themselves from a company they can no longer see. */
  'left-company': 'You left the company. Your account stays, and its Admins can invite you again.',
  /** A company Admin gave themselves a role that doesn't manage members. */
  'company-stepped-down':
    'You’re no longer an Admin of this company, so you don’t manage its members. Another Admin can make you one again.',
} as const;

/** A known notice code. */
export type AccessNoticeCode = keyof typeof ACCESS_NOTICES;

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
 * Returns the note for a notice code.
 *
 * @param code - The `notice` query parameter, if any.
 * @returns The note, or `null` for none or an unknown code.
 */
export function getAccessNotice(code: string | null | undefined): string | null {
  return code && Object.hasOwn(ACCESS_NOTICES, code)
    ? ACCESS_NOTICES[code as AccessNoticeCode]
    : null;
}
