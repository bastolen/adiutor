/**
 * @file The current request's language, for Server Components, server
 * actions and Route Handlers (`next/headers`). Code that runs outside a
 * Next.js request scope (Better Auth's hooks, scripts) uses
 * `localeFromHeaders` or takes the locale as an argument instead.
 */
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { db } from '@/db';

import { loadLanguageSettings } from './default-locale';
import { type LanguageSettings, LOCALE_COOKIE, type Locale, LOCALES } from './locales';
import { resolveLocale } from './resolve-locale';

/**
 * Adiutor's language settings (its default and the languages it offers),
 * read at most once per request: the request's language and the language
 * choices the root layout hands the browser share them. The error pages
 * render inside the root layout too, and the database may be what's failing:
 * then there's no default and every language counts as offered, so the page
 * follows the cookie, else the browser's language.
 */
export const requestLanguageSettings: () => Promise<LanguageSettings> = cache(() =>
  loadLanguageSettings(db).catch((): LanguageSettings => ({
    defaultLocale: null,
    offered: LOCALES,
  })),
);

/**
 * Works out the current request's language (`resolveLocale`): the language
 * cookie while that language is offered, then Adiutor's default language,
 * then (before setup) `Accept-Language`, then English (US). The settings are
 * read once per request, also with a cookie: a cookie for a language that's
 * turned off counts as none.
 *
 * @returns The locale to use.
 */
export default async function requestLocale(): Promise<Locale> {
  const [cookieStore, headerList, settings] = await Promise.all([
    cookies(),
    headers(),
    requestLanguageSettings(),
  ]);
  return resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    configured: settings.defaultLocale,
    offered: settings.offered,
    acceptLanguage: headerList.get('accept-language'),
  });
}
