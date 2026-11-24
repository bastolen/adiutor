/**
 * @file Parses a list of email addresses typed into one field (one per
 * line, or separated by commas, semicolons or spaces), for bulk invitations.
 */
import { MAX_BULK_INVITES } from './input-rules';
import { emailSchema } from './validation';

/** One entry of a list: everything up to the next line break, comma, semicolon or space. */
const ENTRY = /[^\s,;]+/g;

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
 * It stops reading once it has found more entries than one bulk invitation
 * may hold ({@link MAX_BULK_INVITES}), counting each valid address once and
 * every invalid entry: such a list is refused whatever follows (as too long,
 * or for an invalid entry), so the rest of up to a megabyte isn't read. A
 * list within the limit is read to its end, however often an address is
 * repeated in it. Duplicates are found with a set, so its time grows in
 * proportion to the list.
 *
 * @param text - What was typed.
 * @returns The valid addresses and the invalid entries, of a list too long only those read.
 */
export function parseEmailList(text: string): EmailList {
  const emails = new Set<string>();
  const invalid: string[] = [];
  for (const [entry] of text.matchAll(ENTRY)) {
    if (emails.size + invalid.length > MAX_BULK_INVITES) {
      break;
    }
    const parsed = emailSchema.safeParse(entry);
    if (parsed.success) {
      emails.add(parsed.data);
    } else {
      invalid.push(entry);
    }
  }
  return { emails: [...emails], invalid };
}
