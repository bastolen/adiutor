/**
 * @file Makes the browser's language and time zone mirror the account at
 * sign-in: the language cookie gets the account's saved language and the time
 * zone cookie its saved zone, so the app shows them on any browser. For an
 * account on Default (no saved language) the language cookie is removed, so
 * the browser follows Adiutor's default language too; for an account without
 * a zone yet the time zone cookie is removed, and the first page saves the
 * browser's zone (`SaveBrowserTimeZone`; docs/i18n.md, "Time zones").
 *
 * Signing in never saves a language or a zone with the account. A language
 * cookie left in the browser says nothing about who picked it: signing out
 * keeps it, and every sign-in of an account with a saved language writes it.
 * Saving it would give the next person on a shared browser the last one's
 * language, for their screens and their emails, and undo a Default chosen in
 * another browser. A language is saved only when its owner picks it, signed
 * in (`setOwnLocale`; docs/i18n.md, "How the language is chosen", and
 * decision 0020). Rendering then reads only the cookies.
 */
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { user } from '@/db/schema';
import localeCookieOptions from '@/lib/i18n/locale-cookie';
import { isLocale, LOCALE_COOKIE } from '@/lib/i18n/locales';
import timeZoneCookieOptions from '@/lib/i18n/time-zone-cookie';
import { isTimeZone, TIME_ZONE_COOKIE } from '@/lib/i18n/time-zones';

import { expireCookieIfSent } from './cookies';
import type { AuthHookContext } from './hook-context';

/**
 * Sets the language and time zone cookies to a user's saved language and
 * zone, reading their row once. For an account on Default it removes the
 * language cookie the browser sent (whatever it holds), and for one without a
 * zone the time zone cookie. Nothing is saved with the account. Called once a
 * sign-in's session is settled: never for a password whose code step is still
 * to come, so the password alone changes nothing.
 *
 * @param ctx - The endpoint context, after the request.
 * @param userId - The user who signed in.
 */
export default async function rememberLanguageAndTimeZone(
  ctx: AuthHookContext,
  userId: string,
): Promise<void> {
  const [found] = await db
    .select({ locale: user.locale, timeZone: user.timeZone })
    .from(user)
    .where(eq(user.id, userId));
  if (!found) {
    return;
  }
  if (isLocale(found.locale)) {
    ctx.setCookie?.(LOCALE_COOKIE, found.locale, localeCookieOptions());
  } else {
    // On Default: a language left in this browser isn't this person's choice, so it goes.
    expireCookieIfSent(ctx, LOCALE_COOKIE);
  }
  if (isTimeZone(found.timeZone)) {
    ctx.setCookie?.(TIME_ZONE_COOKIE, found.timeZone, timeZoneCookieOptions());
  } else {
    // No zone yet: one left in this browser isn't this person's, so it goes.
    expireCookieIfSent(ctx, TIME_ZONE_COOKIE);
  }
}
