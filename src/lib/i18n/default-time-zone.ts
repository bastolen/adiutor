/**
 * @file Adiutor's own default time zone (the `staff.default_time_zone`
 * setting, taken from the first Admin's browser at setup and changeable on
 * the Staff page), for signed-out pages, for people whose zone isn't known
 * yet, and for emails to them. Takes the database as an argument, like the
 * services. See docs/i18n.md, "Time zones".
 */
import type { DatabaseOrTransaction } from '@/db';
import { readSettings } from '@/server/settings';

/**
 * Loads Adiutor's default time zone.
 *
 * @param db - Database client or transaction.
 * @returns The zone; UTC before setup.
 */
export default async function loadDefaultTimeZone(db: DatabaseOrTransaction): Promise<string> {
  const settings = await readSettings(db, ['staff.default_time_zone']);
  return settings['staff.default_time_zone'];
}
