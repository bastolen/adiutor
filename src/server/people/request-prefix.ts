/**
 * @file Reads the prefix request numbers are shown with (the
 * `requests.prefix` setting): "AD" in "AD-142". Kept apart from `staff.ts`,
 * like the staff's name, so any service can use it without import cycles.
 */
import type { DatabaseOrTransaction } from '@/db';

import { readSettings } from '../settings';

/**
 * Loads the prefix request numbers are shown with.
 *
 * @param db - Database client or transaction.
 * @returns The prefix, e.g. "AD" (also until the staff choose one).
 */
export default async function getRequestPrefix(db: DatabaseOrTransaction): Promise<string> {
  const settings = await readSettings(db, ['requests.prefix']);
  return settings['requests.prefix'];
}
