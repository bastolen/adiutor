/**
 * @file How an email address is compared and keyed. Pure, so the server, the
 * auth guards and rate-limit keys all normalize the same way.
 *
 * `emailSchema` (`validation.ts`) does the same with zod's `.trim().toLowerCase()`
 * for form input; keep the two in step.
 */

/**
 * An email address as it is compared and keyed: trimmed and lower-cased.
 *
 * @param value - The address as sent, if any (anything but a string counts as none).
 * @returns The address, or `null` without one (also for a blank string).
 */
export function normalizeEmail(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}
