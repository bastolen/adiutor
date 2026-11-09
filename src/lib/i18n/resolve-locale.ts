/**
 * @file Works out a request's language from the browser's choice (the
 * language cookie), Adiutor's own default language and what the browser asks
 * for (`Accept-Language`). Pure, so pages, server actions, the sign-in hooks
 * and tests share one rule; the default is read by the callers
 * (`default-locale.ts`). A signed-in user's saved language reaches the cookie
 * at sign-in. See docs/i18n.md.
 */
import { match } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALES, type Locale } from './locales';

/**
 * Reads the language cookie's value.
 *
 * @param value - The cookie's value, if the browser sent one.
 * @returns The locale, or `null` when it's missing or not one we speak.
 */
export function localeFromCookie(value: string | null | undefined): Locale | null {
  return isLocale(value) ? value : null;
}

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
 * The request's language: the browser's choice (the cookie), else Adiutor's
 * default language (`staff_settings.default_locale`), else, before setup
 * (when there's no default yet), the best match for `Accept-Language`, else
 * {@link DEFAULT_LOCALE}.
 *
 * @param request - What the request says, and Adiutor's default.
 * @param request.cookie - The language cookie's value, if any.
 * @param request.configured - Adiutor's default language, or `null` before setup.
 * @param request.acceptLanguage - The `Accept-Language` header, if any.
 * @returns The locale to use.
 */
export function resolveLocale(request: {
  cookie?: string | null;
  configured?: Locale | null;
  acceptLanguage?: string | null;
}): Locale {
  return (
    localeFromCookie(request.cookie) ??
    request.configured ??
    localeFromAcceptLanguage(request.acceptLanguage) ??
    DEFAULT_LOCALE
  );
}

/**
 * Reads one cookie from a `Cookie` header.
 *
 * @param cookieHeader - The header, if any.
 * @param name - The cookie's name.
 * @returns Its value, or `null` when it isn't there.
 */
function cookieFromHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  const pair = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

/**
 * The language cookie's value in a request's headers, e.g. in Better Auth's
 * hooks (`ctx.headers`), where `next/headers` isn't available.
 *
 * @param headers - The request's headers, if known.
 * @returns The cookie's value, or `null` when it isn't there.
 */
export function localeCookieFromHeaders(headers: Headers | null | undefined): string | null {
  return cookieFromHeader(headers?.get('cookie') ?? null, LOCALE_COOKIE);
}
