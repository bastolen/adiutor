/**
 * @file Reads the name the staff are shown with to users (the single
 * `staff_settings` row), for emails, invite pages and messages. Kept apart
 * from `staff.ts` so any service can use it without import cycles.
 */
import type { DatabaseOrTransaction } from '@/db';
import { staffSettings } from '@/db/schema';

/** Used before setup, when there's no settings row yet. */
const FALLBACK_STAFF_NAME = 'Adiutor';

/**
 * Loads the name the staff are shown with to users.
 *
 * @param db - Database client or transaction.
 * @returns The name, e.g. "Adiutor".
 */
export default async function getStaffName(db: DatabaseOrTransaction): Promise<string> {
  const [found] = await db.select({ name: staffSettings.name }).from(staffSettings).limit(1);
  return found?.name ?? FALLBACK_STAFF_NAME;
}
