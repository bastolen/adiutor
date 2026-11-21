/**
 * @file Reads the name the staff are shown with to users (the `staff.name`
 * setting), for emails, invite pages and messages. Kept apart from
 * `staff.ts` so any service can use it without import cycles.
 */
import type { DatabaseOrTransaction } from '@/db';

import { readSettings } from '../settings';

/**
 * Loads the name the staff are shown with to users.
 *
 * @param db - Database client or transaction.
 * @returns The name, e.g. "Adiutor" (also before setup names the staff).
 */
export default async function getStaffName(db: DatabaseOrTransaction): Promise<string> {
  const settings = await readSettings(db, ['staff.name']);
  return settings['staff.name'];
}
