/**
 * @file Makes the browser's time zone mirror the account at sign-in: the time
 * zone cookie gets the account's saved zone, so the app shows times in it on
 * any browser. For an account without a zone yet the cookie is removed (a
 * sign-out removes it anyway), and the first page saves the browser's zone
 * (`SaveBrowserTimeZone`). Signing in never saves a zone itself. See
 * docs/i18n.md, "Time zones".
 */
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { user } from '@/db/schema';
import timeZoneCookieOptions from '@/lib/i18n/time-zone-cookie';
import { isTimeZone, TIME_ZONE_COOKIE } from '@/lib/i18n/time-zones';

import { expireCookieIfSent } from './cookies';
import type { AuthHookContext } from './hook-context';

/**
 * Sets the time zone cookie to a user's saved zone, or, for an account
 * without one, removes the one the browser sent. Called once a sign-in's
 * session is settled, like `rememberLanguage`.
 *
 * @param ctx - The endpoint context, after the request.
 * @param userId - The user who signed in.
 */
export default async function rememberTimeZone(
  ctx: AuthHookContext,
  userId: string,
): Promise<void> {
  const [found] = await db
    .select({ timeZone: user.timeZone })
    .from(user)
    .where(eq(user.id, userId));
  if (!found) {
    return;
  }
  if (isTimeZone(found.timeZone)) {
    ctx.setCookie?.(TIME_ZONE_COOKIE, found.timeZone, timeZoneCookieOptions());
    return;
  }
  // No zone yet: one left in this browser isn't this person's, so it goes.
  expireCookieIfSent(ctx, TIME_ZONE_COOKIE);
}
