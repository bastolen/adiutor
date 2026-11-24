/**
 * @file Works out a request's language from the browser's choice (the
 * language cookie), Adiutor's own default language and what the browser asks
 * for (`Accept-Language`), counting only the languages Adiutor offers. Pure,
 * so pages, server actions, the sign-in hooks and tests share one rule; the
 * settings are read by the callers (`default-locale.ts`). A signed-in user's saved language reaches the cookie
 * at sign-in. See docs/i18n.md.
 */
import { match } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';

import {
  DEFAULT_LOCALE,
  isLocale,
  languageCookieValue,
  LOCALES,
  type Locale,
  offeredLocale,
} from './locales';

/**
 * Picks the language we speak that best matches an `Accept-Language`
 * header, in the browser's order of preference: `nl-BE` gets Dutch,
 * `es-MX` Spanish and `en-GB` English (US).
 *
 * @param header - The header, if the browser sent one.
 * @returns The locale, or `null` when the browser asks for none we speak.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) {
    return null;
  }
  const requested = new Negotiator({ headers: { 'accept-language': header } })
    .languages()
    .filter((tag) => {
      try {
        return Intl.getCanonicalLocales(tag).length > 0;
      } catch {
        // Not a language tag (e.g. `*` or garbage): skipped, like an unknown language.
        return false;
      }
    });
  if (requested.length === 0) {
    return null;
  }
  // A sentinel default tells "no match" apart from a match with the default locale.
  const matched = match(requested, LOCALES, 'zxx');
  return isLocale(matched) ? matched : null;
}

/**
 * The request's language: the browser's choice (the cookie) while that
 * language is offered, else Adiutor's default language
 * (the `staff.default_locale` setting, always offered), else, before setup
 * (when there's no default yet and every language is offered), the best
 * match for `Accept-Language`, else {@link DEFAULT_LOCALE}.
 *
 * @param request - What the request says, and Adiutor's settings.
 * @param request.cookie - The language cookie's value, if any.
 * @param request.configured - Adiutor's default language, or `null` before setup.
 * @param request.offered - The languages that are on; every language when left out.
 * @param request.acceptLanguage - The `Accept-Language` header, if any.
 * @returns The locale to use.
 */
export function resolveLocale(request: {
  cookie?: string | null;
  configured?: Locale | null;
  offered?: readonly Locale[];
  acceptLanguage?: string | null;
}): Locale {
  return (
    offeredLocale(request.cookie, request.offered ?? LOCALES) ??
    request.configured ??
    localeFromAcceptLanguage(request.acceptLanguage) ??
    DEFAULT_LOCALE
  );
}

/**
 * The language cookie's value in a request's headers, e.g. in Better Auth's
 * hooks (`ctx.headers`), where `next/headers` isn't available.
 *
 * @param headers - The request's headers, if known.
 * @returns The cookie's value, or `null` when it isn't there.
 */
export function localeCookieFromHeaders(headers: Headers | null | undefined): string | null {
  return languageCookieValue(headers?.get('cookie'));
}
