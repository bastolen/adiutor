/**
 * @file Adiutor's own default time zone (`staff_settings.default_time_zone`,
 * taken from the first Admin's browser at setup and changeable on the Staff
 * page), for signed-out pages, for people whose zone isn't known yet, and for
 * emails to them. Takes the database as an argument, like the services. See
 * docs/i18n.md, "Time zones".
 */
import type { DatabaseOrTransaction } from '@/db';
import { staffSettings } from '@/db/schema';

import { DEFAULT_TIME_ZONE, isTimeZone } from './time-zones';

/**
 * Loads Adiutor's default time zone.
 *
 * @param db - Database client or transaction.
 * @returns The zone; UTC before setup (no settings row yet).
 */
export default async function loadDefaultTimeZone(db: DatabaseOrTransaction): Promise<string> {
  const [found] = await db
    .select({ timeZone: staffSettings.defaultTimeZone })
    .from(staffSettings)
    .limit(1);
  return found && isTimeZone(found.timeZone) ? found.timeZone : DEFAULT_TIME_ZONE;
}
