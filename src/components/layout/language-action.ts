/**
 * @file Server action for the theme and language menu in the corner of the
 * pages without the account menu (`PreferencesMenu`): remembers the browser's
 * choice in the language cookie, or deletes it for Default, so the browser
 * follows Adiutor's default language again. The page then reloads in that
 * language.
 *
 * Signed in, on the pages with that menu a signed-in person reaches (the
 * step-up page, an invitation or invite link, the not-found and error
 * pages), the choice is saved with the account too, as the account page's
 * Language card does. Otherwise the screens would change while the card and
 * the emails stayed as they were (docs/i18n.md, "How the language is
 * chosen").
 */
'use server';

import { cookies } from 'next/headers';

import { mustStepUp } from '@/lib/authz/mfa';
import localeCookieOptions from '@/lib/i18n/locale-cookie';
import { FOLLOW_DEFAULT, isLanguageChoice, LOCALE_COOKIE } from '@/lib/i18n/locales';
import { requestLanguageSettings } from '@/lib/i18n/request-locale';
import appContext from '@/server/app-context';
import { assertNotSignedInAs, getOptionalActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import setOwnLocale from '@/server/people/own-locale';

/**
 * Sets the language cookie to the chosen language, or deletes it for Default.
 * With a session, the choice is saved with the account first (`setOwnLocale`;
 * Default saves none), by the rules of the Language card:
 *
 * - While a staff member is signed in as the user, it's refused, like every
 *   change (`assertNotSignedInAs`), and the cookie stays as it is too: the
 *   menu does nothing. That's checked first: the user's session facts are
 *   empty then, so the next rule would take the session for an unconfirmed
 *   one and change the cookie.
 * - A session that still has to be confirmed with its second step
 *   (`mustStepUp`) changes nothing in the account, as it can't reach the card
 *   either (`getActor` sends it to the step-up page). Its choice stays in the
 *   browser, as when signed out, so the step-up page can still be read.
 *
 * A session that can't be read counts as none. A language that's turned off
 * isn't offered here either (decision 0029): it's refused before anything
 * changes, unless the settings can't be read (the error page, with the
 * database failing).
 *
 * @param choice - A language, or `FOLLOW_DEFAULT`, as the menu sent it.
 * @returns Whether it was one of those and wasn't refused.
 */
export default async function setLanguageAction(choice: unknown): Promise<boolean> {
  if (!isLanguageChoice(choice)) {
    return false;
  }
  if (choice !== FOLLOW_DEFAULT) {
    const settings = await requestLanguageSettings().catch(() => null);
    if (settings && !settings.offered.includes(choice)) {
      return false;
    }
  }
  // The error page has this menu too, and the database may be what's failing: a session that
  // can't be read counts as none, so the browser's own language still changes.
  const actor = await getOptionalActor().catch(() => null);
  if (actor) {
    try {
      assertNotSignedInAs(actor);
      if (!mustStepUp(actor)) {
        await setOwnLocale(appContext, actor, choice);
      }
    } catch (error) {
      if (error instanceof ServiceError) {
        return false;
      }
      throw error;
    }
  }
  const cookieStore = await cookies();
  if (choice === FOLLOW_DEFAULT) {
    cookieStore.delete(LOCALE_COOKIE);
  } else {
    cookieStore.set(LOCALE_COOKIE, choice, localeCookieOptions());
  }
  return true;
}
