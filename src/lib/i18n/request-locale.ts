/**
 * @file The current request's language, for Server Components, server
 * actions and Route Handlers (`next/headers`). Code that runs outside a
 * Next.js request scope (Better Auth's hooks, scripts) uses
 * `localeFromHeaders` or takes the locale as an argument instead.
 */
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { db } from '@/db';

import { loadDefaultLocale } from './default-locale';
import { LOCALE_COOKIE, type Locale } from './locales';
import { localeFromCookie, resolveLocale } from './resolve-locale';

/** Adiutor's default language, read at most once per request. */
const defaultLocale = cache(() => loadDefaultLocale(db));

/**
 * Works out the current request's language (`resolveLocale`): the language
 * cookie, then Adiutor's default language, then (before setup)
 * `Accept-Language`, then English (US). The default is only read from the
 * database when there's no cookie, which signed-in people always have.
 *
 * @returns The locale to use.
 */
export default async function requestLocale(): Promise<Locale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const chosen = localeFromCookie(cookieStore.get(LOCALE_COOKIE)?.value);
  if (chosen) {
    return chosen;
  }
  return resolveLocale({
    configured: await defaultLocale(),
    acceptLanguage: headerList.get('accept-language'),
  });
}
