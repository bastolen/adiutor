/**
 * @file The signed-in user's own time zone, saved with their account, so
 * every page, email and copied note shows times in it, on every browser they
 * sign in on (the time zone cookie mirrors it: set at sign-in,
 * `rememberTimeZone`, and whenever it's saved). Their browser saves the first
 * one, the first time they're signed in. Not a security change: no audit
 * event or notice. See docs/i18n.md, "Time zones".
 */
import { and, eq, isNull } from 'drizzle-orm';

import { user } from '@/db/schema';
import { isTimeZone } from '@/lib/i18n/time-zones';

import { assertNotSignedInAs } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';

/**
 * Saves the zone the user's browser shows as their account's, the first time
 * they're signed in: only while the account has no zone yet, so it never
 * overwrites one they (or another browser) saved before. A zone Adiutor
 * doesn't accept (`isTimeZone`) saves nothing.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param browserZone - The browser's zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
 * @returns The account's zone afterwards (this one, or the one it had), or
 *   `null` when it still has none.
 * @throws {ServiceError} `signed_in_as` while a staff member is signed in as
 *   the user: the browser is the staff member's.
 */
export default async function saveFirstTimeZone(
  ctx: ServiceContext,
  actor: Actor,
  browserZone: unknown,
): Promise<string | null> {
  assertNotSignedInAs(actor);
  if (isTimeZone(browserZone)) {
    await ctx.db
      .update(user)
      .set({ timeZone: browserZone })
      .where(and(eq(user.id, actor.id), isNull(user.timeZone)));
  }
  const [found] = await ctx.db
    .select({ timeZone: user.timeZone })
    .from(user)
    .where(eq(user.id, actor.id));
  return isTimeZone(found?.timeZone) ? found.timeZone : null;
}
