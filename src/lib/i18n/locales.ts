/**
 * @file The languages Adiutor speaks, and the cookie that remembers a
 * browser's choice.
 *
 * Imports only the pure `cookie-value.ts` on purpose: `src/lib/auth.ts` reads {@link LOCALES} for
 * the user's saved language, and the Better Auth CLI (`pnpm auth:schema`)
 * loads that file without React or Next.js. See docs/i18n.md.
 */
import { cookieValue } from '../request/cookie-value';

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
 * The language choice "Default": follow Adiutor's default language (chosen on
 * Settings, the `staff.default_locale` setting), now and after it changes.
 * An account on Default has no saved language (`user.locale` is `null`), and a
 * browser on Default has no {@link LOCALE_COOKIE}. Form fields and the
 * language menu send it as their value.
 */
export const FOLLOW_DEFAULT = 'default';

/** A language choice: one of the {@link LOCALES}, or {@link FOLLOW_DEFAULT}. */
export type LanguageChoice = Locale | typeof FOLLOW_DEFAULT;

/**
 * Reads the language cookie's value from a list of cookies: a request's
 * `Cookie` header, or `document.cookie` in the browser.
 *
 * @param cookies - The cookies, as `name=value` pairs split by `;`.
 * @returns The cookie's value (not yet checked with {@link isLocale}), or
 * `null` when it isn't there or can't be read.
 */
export function languageCookieValue(cookies: string | null | undefined): string | null {
  return cookieValue(cookies, LOCALE_COOKIE);
}

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

/**
 * Checks whether a value is a {@link LanguageChoice}: a language, or
 * {@link FOLLOW_DEFAULT}.
 *
 * @param value - The value to check, e.g. a form field.
 * @returns Whether it is a {@link LanguageChoice}.
 */
export function isLanguageChoice(value: unknown): value is LanguageChoice {
  return value === FOLLOW_DEFAULT || isLocale(value);
}

/**
 * Adiutor's language settings (the `staff.*` settings): its default language, and
 * the languages it offers, which staff Admins turn on and off (decision
 * 0029). Before setup there's no default yet and every language is offered.
 */
export interface LanguageSettings {
  /** The default language, or `null` before setup. */
  defaultLocale: Locale | null;
  /** The languages that are on, in the order of {@link LOCALES}; always holds the default. */
  offered: readonly Locale[];
}

/**
 * A language only while it's offered: a saved language, a cookie or an
 * invitation's language that's turned off counts as none, so whoever chose
 * it gets the default language (their choice is kept for when it's on
 * again).
 *
 * @param value - The language, e.g. `user.locale` or the cookie's value.
 * @param offered - The languages that are on ({@link LanguageSettings.offered}).
 * @returns The locale, or `null` when it isn't one, or is off.
 */
export function offeredLocale(value: unknown, offered: readonly Locale[]): Locale | null {
  return isLocale(value) && offered.includes(value) ? value : null;
}
