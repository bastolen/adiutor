/**
 * @file Reading what an email says: its language and the token in its link.
 */
import { defined } from '@/lib/defined';
import type { Email } from '@/lib/email';

/**
 * Reads the language an email is written in, from its `<html lang>`.
 *
 * @param email - The email.
 * @returns The locale, e.g. `nl-NL`.
 */
export function emailLanguage(email: Email): string {
  const match = /<html[^>]*\slang="([^"]+)"/.exec(email.html);
  return defined(match?.[1], `the language of the email "${email.subject}"`);
}

/**
 * Extracts the invitation or invite-link token from an email's text.
 *
 * @param email - The email.
 * @returns The token.
 */
export function tokenFrom(email: Email): string {
  const match = email.text.match(/\/(?:invite|join)\/([A-Za-z0-9_-]+)/);
  if (!match) {
    throw new Error(`No link in email: ${email.subject}`);
  }
  return defined(match[1], `the token in the email "${email.subject}"`);
}
