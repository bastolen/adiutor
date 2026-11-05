/**
 * @file Parses a list of email addresses typed into one field (one per
 * line, or separated by commas, semicolons or spaces), for bulk invitations.
 */
import { emailSchema } from './validation';

/** A parsed list of addresses. */
export interface EmailList {
  /** Valid addresses, normalized and without duplicates, in the order typed. */
  emails: string[];
  /** Entries that aren't valid email addresses, as typed. */
  invalid: string[];
}

/**
 * Splits and validates a list of email addresses. Display names in angle
 * brackets aren't supported; enter plain addresses.
 *
 * @param text - What was typed.
 * @returns The valid addresses and the invalid entries.
 */
export function parseEmailList(text: string): EmailList {
  const emails: string[] = [];
  const invalid: string[] = [];
  text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .forEach((entry) => {
      const parsed = emailSchema.safeParse(entry);
      if (!parsed.success) {
        invalid.push(entry);
      } else if (!emails.includes(parsed.data)) {
        emails.push(parsed.data);
      }
    });
  return { emails, invalid };
}
