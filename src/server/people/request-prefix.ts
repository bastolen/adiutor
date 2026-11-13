/**
 * @file Reads the prefix request numbers are shown with (the single
 * `staff_settings` row): "AD" in "AD-142". Kept apart from `staff.ts`, like
 * the staff's name, so any service can use it without import cycles.
 */
import type { DatabaseOrTransaction } from '@/db';
import { staffSettings } from '@/db/schema';
import { DEFAULT_REQUEST_PREFIX } from '@/lib/requests';

/**
 * Loads the prefix request numbers are shown with.
 *
 * @param db - Database client or transaction.
 * @returns The prefix, e.g. "AD" (also before setup, when there's no settings row yet).
 */
export default async function getRequestPrefix(db: DatabaseOrTransaction): Promise<string> {
  const [found] = await db
    .select({ prefix: staffSettings.requestPrefix })
    .from(staffSettings)
    .limit(1);
  return found?.prefix ?? DEFAULT_REQUEST_PREFIX;
}
