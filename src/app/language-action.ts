/**
 * @file Server action for the language menu on the signed-out pages: remembers
 * the browser's choice in the language cookie. The page then reloads in that
 * language. Signed in, the account page saves the language with the account
 * instead (docs/i18n.md).
 */
'use server';

import { cookies } from 'next/headers';

import localeCookieOptions from '@/lib/i18n/locale-cookie';
import { isLocale, LOCALE_COOKIE } from '@/lib/i18n/locales';

/**
 * Sets the language cookie, if the value is one of the languages.
 *
 * @param locale - The chosen locale, as the menu sent it.
 * @returns Whether it was set.
 */
export default async function setLanguageAction(locale: unknown): Promise<boolean> {
  if (!isLocale(locale)) {
    return false;
  }
  (await cookies()).set(LOCALE_COOKIE, locale, localeCookieOptions());
  return true;
}
