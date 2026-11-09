/**
 * @file Keeps the browser's language in step with the account at sign-in:
 * the language cookie gets the account's saved language, so the app shows it
 * on any browser. An account on Default (no saved language) keeps following
 * Adiutor's default language, unless this browser has a language someone
 * picked (the cookie, from the signed-out language menu): that choice is
 * saved with the account. A guessed language (Adiutor's default or the
 * browser's) is never saved. Rendering then reads only the cookie
 * (docs/i18n.md, "How the language is chosen").
 */
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { user } from '@/db/schema';
import localeCookieOptions from '@/lib/i18n/locale-cookie';
import { isLocale, LOCALE_COOKIE } from '@/lib/i18n/locales';
import { localeCookieFromHeaders, localeFromCookie } from '@/lib/i18n/resolve-locale';

import type { AuthHookContext } from './hook-context';

/**
 * Sets the language cookie from a user's saved language, or, for an account
 * on Default, saves the language picked in this browser. Called once a
 * sign-in's session is settled: never for a password whose code step is
 * still to come, so the password alone changes nothing.
 *
 * @param ctx - The endpoint context, after the request.
 * @param userId - The user who signed in.
 */
export default async function rememberLanguage(
  ctx: AuthHookContext,
  userId: string,
): Promise<void> {
  const [found] = await db.select({ locale: user.locale }).from(user).where(eq(user.id, userId));
  if (!found) {
    return;
  }
  if (isLocale(found.locale)) {
    ctx.setCookie?.(LOCALE_COOKIE, found.locale, localeCookieOptions());
    return;
  }
  const picked = localeFromCookie(localeCookieFromHeaders(ctx.headers));
  if (!picked) {
    // On Default with nothing picked here: the browser keeps following the default.
    return;
  }
  // Only while nothing is saved: a choice made meanwhile (another sign-in) stays.
  await db
    .update(user)
    .set({ locale: picked })
    .where(and(eq(user.id, userId), isNull(user.locale)));
}
