/**
 * @file Makes the browser's language mirror the account at sign-in: the
 * language cookie gets the account's saved language, so the app shows it on
 * any browser, and for an account on Default (no saved language) the cookie
 * is removed, so the browser follows Adiutor's default language too.
 *
 * Signing in never saves a language with the account. A language cookie left
 * in the browser says nothing about who picked it: signing out keeps it, and
 * every sign-in of an account with a saved language writes it. Saving it
 * would give the next person on a shared browser the last one's language,
 * for their screens and their emails, and undo a Default chosen in another
 * browser. A language is saved only when its owner picks it, signed in
 * (`setOwnLocale`; docs/i18n.md, "How the language is chosen", and decision
 * 0020). Rendering then reads only the cookie.
 */
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { user } from '@/db/schema';
import localeCookieOptions from '@/lib/i18n/locale-cookie';
import { isLocale, LOCALE_COOKIE } from '@/lib/i18n/locales';

import { expireCookieIfSent } from './cookies';
import type { AuthHookContext } from './hook-context';

/**
 * Sets the language cookie to a user's saved language, or, for an account on
 * Default, removes the one the browser sent (whatever it holds). Nothing is
 * saved with the account. Called once a sign-in's session is settled: never
 * for a password whose code step is still to come, so the password alone
 * changes nothing.
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
  // On Default: a language left in this browser isn't this person's choice, so it goes.
  expireCookieIfSent(ctx, LOCALE_COOKIE);
}
