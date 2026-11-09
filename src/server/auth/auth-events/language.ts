/**
 * @file Keeps the browser's language in step with the account at sign-in:
 * the language cookie gets the account's saved language, so the app shows it
 * on any browser, and an account without one (until now everyone, and anyone
 * created without a choice) saves the language it signed in with. Rendering
 * then reads only the cookie (docs/i18n.md, "How the language is chosen").
 */
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { user } from '@/db/schema';
import { localeFromHeaders } from '@/lib/i18n/default-locale';
import localeCookieOptions from '@/lib/i18n/locale-cookie';
import { isLocale, LOCALE_COOKIE } from '@/lib/i18n/locales';

import type { AuthHookContext } from './hook-context';

/**
 * Sets the language cookie from a user's saved language, saving the
 * request's language first when they have none. Called once a sign-in's
 * session is settled: never for a password whose code step is still to come,
 * so the password alone changes nothing.
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
  let locale = isLocale(found.locale) ? found.locale : null;
  if (!locale) {
    locale = await localeFromHeaders(ctx.headers, db);
    // Only while nothing is saved: a choice made meanwhile (another sign-in) stays.
    await db
      .update(user)
      .set({ locale })
      .where(and(eq(user.id, userId), isNull(user.locale)));
  }
  ctx.setCookie?.(LOCALE_COOKIE, locale, localeCookieOptions());
}
