/**
 * @file Adiutor's own default language (`staff_settings.default_locale`,
 * chosen at setup and on the staff page), and the language of a request known
 * only by its headers (Better Auth's hooks and callbacks), which needs it.
 * Takes the database as an argument, like the services. See docs/i18n.md,
 * "How the language is chosen".
 */
import type { DatabaseOrTransaction } from '@/db';
import { staffSettings } from '@/db/schema';

import { isLocale, type Locale } from './locales';
import { localeCookieFromHeaders, localeFromCookie, resolveLocale } from './resolve-locale';

/**
 * Loads Adiutor's default language.
 *
 * @param db - Database client or transaction.
 * @returns The language, or `null` before setup (no settings row yet).
 */
export async function loadDefaultLocale(db: DatabaseOrTransaction): Promise<Locale | null> {
  const [found] = await db
    .select({ locale: staffSettings.defaultLocale })
    .from(staffSettings)
    .limit(1);
  return found && isLocale(found.locale) ? found.locale : null;
}

/**
 * The language of a request known by its headers: the language cookie, else
 * Adiutor's default, else (before setup) `Accept-Language`, else English
 * (US). Reads the default only when there's no cookie.
 *
 * @param headers - The request's headers, if known.
 * @param db - Database client, for Adiutor's default.
 * @returns The locale to use.
 */
export async function localeFromHeaders(
  headers: Headers | null | undefined,
  db: DatabaseOrTransaction,
): Promise<Locale> {
  const chosen = localeFromCookie(localeCookieFromHeaders(headers));
  if (chosen) {
    return chosen;
  }
  return resolveLocale({
    configured: await loadDefaultLocale(db),
    acceptLanguage: headers?.get('accept-language'),
  });
}
