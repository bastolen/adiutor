/**
 * @file The languages Adiutor speaks, and the cookie that remembers a
 * browser's choice.
 *
 * Imports nothing on purpose: `src/lib/auth.ts` reads {@link LOCALES} for
 * the user's saved language, and the Better Auth CLI (`pnpm auth:schema`)
 * loads that file without React or Next.js. See docs/i18n.md.
 */

/**
 * Every language, as a BCP 47 tag with its region, in the order the language
 * menus show them. The first is the default. A new language also needs its
 * catalogue folder (`src/messages/<locale>/`) and `pnpm auth:schema`; the
 * checklist is in docs/i18n.md.
 */
export const LOCALES = ['en-US', 'nl-NL', 'es-ES'] as const;

/** One of the {@link LOCALES}. */
export type Locale = (typeof LOCALES)[number];

/** The language for anyone who hasn't chosen one and whose browser asks for none we speak. */
export const DEFAULT_LOCALE: Locale = 'en-US';

/**
 * Each language's name in that language, as the language menus show it, so
 * people find their own whichever language the page is in.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  'en-US': 'English (US)',
  'nl-NL': 'Nederlands',
  'es-ES': 'Español',
};

/**
 * The cookie that remembers the browser's language. It isn't `HttpOnly`: the
 * last-resort error page (`src/app/global-error.tsx`) reads it in the browser.
 * It holds nothing but a locale, validated with {@link isLocale} wherever
 * it's read, and it survives signing out like the "Last used" hint.
 */
export const LOCALE_COOKIE = 'adiutor.locale';

/**
 * Picks the first language we speak among a browser's languages, by the
 * language alone (`nl-BE` gets Dutch, `en-GB` English (US)). A light match
 * for the browser, where the full `Accept-Language` matching of
 * `resolve-locale.ts` would ship its libraries.
 *
 * @param languages - The browser's languages, most wanted first (`navigator.languages`).
 * @returns The locale, or `null` when none matches.
 */
export function localeForLanguages(languages: readonly string[]): Locale | null {
  for (const tag of languages) {
    const language = tag.split('-')[0]?.toLowerCase();
    const match = LOCALES.find((locale) => locale.split('-')[0] === language);
    if (match) {
      return match;
    }
  }
  return null;
}

/**
 * Checks whether a value is one of the {@link LOCALES}, e.g. a cookie or a
 * form field.
 *
 * @param value - The value to check.
 * @returns Whether it is a {@link Locale}.
 */
export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}
