/**
 * @file Which time zone an email's times are in: the recipient's own saved
 * zone, else the zone of whoever invited them (an invitation keeps its
 * sender's), else Adiutor's default zone. The zone of whoever caused the email
 * doesn't count otherwise, like the language (`recipient-locale.ts`). An email
 * that shows a time names its zone, so a reader elsewhere can tell. See
 * "Which time zone" in docs/email.md.
 */
import loadDefaultTimeZone from '@/lib/i18n/default-time-zone';
import { isTimeZone } from '@/lib/i18n/time-zones';

import type { ServiceContext } from './context';

/**
 * Works out the time zone of an email to someone.
 *
 * @param ctx - Service context; its database holds Adiutor's default zone.
 * @param saved - The zones that may apply, most specific first: the
 *   recipient's own (`user.time_zone`), then an invitation's. Missing or
 *   unknown ones are skipped.
 * @returns The first known zone, else Adiutor's default zone (UTC before setup).
 */
export default async function recipientTimeZone(
  ctx: Pick<ServiceContext, 'db'>,
  ...saved: (string | null | undefined)[]
): Promise<string> {
  const known = saved.find(isTimeZone);
  return known ?? loadDefaultTimeZone(ctx.db);
}
