/**
 * @file Server action for the language menu on the signed-out pages: remembers
 * the browser's choice in the language cookie, or deletes it for Default, so
 * the browser follows Adiutor's default language again. The page then reloads
 * in that language. Signed in, the account page saves the choice with the
 * account instead (docs/i18n.md).
 */
'use server';

import { cookies } from 'next/headers';

import localeCookieOptions from '@/lib/i18n/locale-cookie';
import { FOLLOW_DEFAULT, isLanguageChoice, LOCALE_COOKIE } from '@/lib/i18n/locales';

/**
 * Sets the language cookie to the chosen language, or deletes it for Default.
 *
 * @param choice - A language, or `FOLLOW_DEFAULT`, as the menu sent it.
 * @returns Whether it was one of those.
 */
export default async function setLanguageAction(choice: unknown): Promise<boolean> {
  if (!isLanguageChoice(choice)) {
    return false;
  }
  const cookieStore = await cookies();
  if (choice === FOLLOW_DEFAULT) {
    cookieStore.delete(LOCALE_COOKIE);
  } else {
    cookieStore.set(LOCALE_COOKIE, choice, localeCookieOptions());
  }
  return true;
}
