/**
 * @file Adiutor's own default language (`staff_settings.default_locale`,
 * chosen at setup and on the staff page) and the languages it offers
 * (`staff_settings.offered_locales`), and the language of a request known
 * only by its headers (Better Auth's hooks and callbacks), which needs them.
 * Takes the database as an argument, like the services. See docs/i18n.md,
 * "How the language is chosen".
 */
import type { DatabaseOrTransaction } from '@/db';
import { staffSettings } from '@/db/schema';

import { isLocale, type LanguageSettings, type Locale, LOCALES } from './locales';
import { localeCookieFromHeaders, resolveLocale } from './resolve-locale';

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
 * Loads Adiutor's language settings: its default language and the languages
 * it offers, in the order of `LOCALES`. Before setup (no settings row yet)
 * there's no default and every language is offered.
 *
 * @param db - Database client or transaction.
 * @returns The settings.
 */
export async function loadLanguageSettings(db: DatabaseOrTransaction): Promise<LanguageSettings> {
  const [found] = await db
    .select({ locale: staffSettings.defaultLocale, offered: staffSettings.offeredLocales })
    .from(staffSettings)
    .limit(1);
  if (!found) {
    return { defaultLocale: null, offered: LOCALES };
  }
  return {
    defaultLocale: isLocale(found.locale) ? found.locale : null,
    offered: LOCALES.filter((locale) => found.offered.includes(locale)),
  };
}

/**
 * The language of a request known by its headers: the language cookie while
 * that language is offered, else Adiutor's default, else (before setup)
 * `Accept-Language`, else English (US). Reads the settings every time, since
 * a cookie only counts for a language that's on.
 *
 * @param headers - The request's headers, if known.
 * @param db - Database client, for Adiutor's settings.
 * @returns The locale to use.
 */
export async function localeFromHeaders(
  headers: Headers | null | undefined,
  db: DatabaseOrTransaction,
): Promise<Locale> {
  const settings = await loadLanguageSettings(db);
  return resolveLocale({
    cookie: localeCookieFromHeaders(headers),
    configured: settings.defaultLocale,
    offered: settings.offered,
    acceptLanguage: headers?.get('accept-language'),
  });
}
