/**
 * @file Server actions for the Profile and Preferences tabs of the account
 * (name, picture and email verification; language, time zone and emails about
 * requests). They go through Better Auth, so its rules apply. Their messages
 * are in the request's language. The Security tab's actions are in
 * `./security/actions.ts`, and the Activity tab's in `./activity/actions.ts`.
 */
'use server';

import { isAPIError } from 'better-auth/api';
import { refresh } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import { auth } from '@/lib/auth';
import field from '@/lib/form-data';
import localeCookieOptions from '@/lib/i18n/locale-cookie';
import { LOCALE_COOKIE } from '@/lib/i18n/locales';
import timeZoneCookieOptions from '@/lib/i18n/time-zone-cookie';
import { TIME_ZONE_COOKIE } from '@/lib/i18n/time-zones';
import { withSection } from '@/lib/redirect';
import { nameSchema } from '@/lib/validation';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { assertNotSignedInAs, getActor } from '@/server/authz';
import setOwnLocale from '@/server/people/own-locale';
import saveFirstTimeZone, { setOwnTimeZone } from '@/server/people/own-time-zone';
import { setOwnPicture } from '@/server/people/pictures';
import { setOwnRequestEmails } from '@/server/people/request-emails';
import { assertRateLimit, RATE_LIMITS } from '@/server/rate-limit';

import { LANGUAGE_SECTION, TIME_ZONE_SECTION, VERIFIED_RETURN_PATH } from './account-messages';

/** Where the page reloads after the language changed, to say so in it (`?language=saved`). */
const LANGUAGE_SAVED_PATH = withSection('/account/preferences?language=saved', LANGUAGE_SECTION);

/** Where the page reloads after the time zone changed, to say so in it (`?timeZone=saved`). */
const TIME_ZONE_SAVED_PATH = withSection('/account/preferences?timeZone=saved', TIME_ZONE_SECTION);

/**
 * Saves the signed-in user's language choice with their account, so emails
 * reach them in it, and in this browser's language cookie. Default saves no
 * language and deletes the cookie, so both follow Adiutor's default language.
 * The form then reloads the page (the path it gets back), so every part of
 * it, and every page kept alive, shows the new language at once; the page
 * says it's saved.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `locale`: a language, or `FOLLOW_DEFAULT`.
 * @returns Where to reload to, or why it failed.
 */
export async function saveLanguageAction(
  _previous: ActionResult<string> | null,
  formData: FormData,
): Promise<ActionResult<string>> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    const locale = await setOwnLocale(appContext, actor, field(formData, 'locale'));
    const cookieStore = await cookies();
    if (locale) {
      cookieStore.set(LOCALE_COOKIE, locale, localeCookieOptions());
    } else {
      cookieStore.delete(LOCALE_COOKIE);
    }
    return { ok: true, data: LANGUAGE_SAVED_PATH };
  });
}

/**
 * Saves the signed-in user's time zone with their account, so every page and
 * email shows times in it, and in this browser's time zone cookie. The form
 * then reloads the page (the path it gets back), so every page kept alive
 * shows the new times at once; the page says it's saved.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `timeZone`: an IANA zone, e.g. `Europe/Amsterdam`.
 * @returns Where to reload to, or why it failed.
 */
export async function saveTimeZoneAction(
  _previous: ActionResult<string> | null,
  formData: FormData,
): Promise<ActionResult<string>> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    const timeZone = await setOwnTimeZone(appContext, actor, field(formData, 'timeZone'));
    (await cookies()).set(TIME_ZONE_COOKIE, timeZone, timeZoneCookieOptions());
    return { ok: true, data: TIME_ZONE_SAVED_PATH };
  });
}

/**
 * Saves the zone the browser shows as the signed-in user's, the first time
 * they're signed in (`SaveBrowserTimeZone`, in the navigation), and makes this
 * browser's time zone cookie mirror the account's zone: the one saved now, or
 * one saved before (another browser may have been first). Never overwrites a
 * saved zone. The page loads afresh afterwards when the zone it shows differs.
 *
 * @param browserZone - The browser's zone, e.g. `Europe/Amsterdam`.
 * @returns The account's zone (`null` when it still has none), or why it failed.
 */
export async function saveBrowserTimeZoneAction(
  browserZone: string,
): Promise<ActionResult<string | null>> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    const timeZone = await saveFirstTimeZone(appContext, actor, browserZone);
    if (timeZone) {
      (await cookies()).set(TIME_ZONE_COOKIE, timeZone, timeZoneCookieOptions());
    }
    return { ok: true, data: timeZone };
  });
}

/**
 * Saves which picture the signed-in user shows: the picture of one of their
 * connected accounts, or their initials. The page is refreshed, so the new
 * picture shows wherever they appear on it.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `picture`: `initials` or a provider ID.
 * @returns A confirmation, or why it failed.
 */
export async function savePictureAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    await setOwnPicture(appContext, actor, field(formData, 'picture'));
    refresh();
    const t = await getTranslations('account');
    return { ok: true, message: t('profile.pictureSaved') };
  });
}

/**
 * Changes the signed-in user's display name.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `name`.
 * @returns A confirmation, or why it failed.
 */
export async function updateNameAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    // Better Auth would rename the session's own user: a staff member signed in as someone.
    assertNotSignedInAs(await getActor({ allowMissingMfa: true }));
    const name = nameSchema.parse(field(formData, 'name'));
    await auth.api.updateUser({ body: { name }, headers: await headers() });
    refresh();
    const t = await getTranslations('account');
    return { ok: true, message: t('profile.nameSaved') };
  });
}

/**
 * Emails the signed-in user a link that verifies their address, which comes
 * back to the Email card (`VERIFIED_RETURN_PATH`). Better Auth only sends it
 * for the signed-in user's own, unverified address.
 *
 * @returns A confirmation, or why it failed.
 */
export async function sendVerificationAction(): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    assertNotSignedInAs(actor);
    const t = await getTranslations('account');
    if (actor.emailVerified) {
      return { ok: true, message: t('profile.alreadyVerified') };
    }
    await assertRateLimit(
      appContext,
      `verification-email:user:${actor.id}`,
      RATE_LIMITS.verificationEmailsPerUser,
    );
    try {
      await auth.api.sendVerificationEmail({
        body: { email: actor.email, callbackURL: VERIFIED_RETURN_PATH },
        headers: await headers(),
      });
    } catch (error) {
      if (isAPIError(error)) {
        return { ok: false, message: t('profile.verificationFailed') };
      }
      throw error;
    }
    return { ok: true, message: t('profile.verificationSent', { email: actor.email }) };
  });
}

/**
 * Turns emails about requests on or off for the signed-in user
 * (`setOwnRequestEmails`). The page is refreshed, so the card shows what's
 * set.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `on`: `true` to turn them on, `false` to turn them off.
 * @returns A confirmation, or why it failed.
 */
export async function requestEmailsAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    const on = field(formData, 'on') === 'true';
    await setOwnRequestEmails(appContext, actor, on);
    refresh();
    const t = await getTranslations('account');
    return {
      ok: true,
      message: on ? t('profile.requestEmailsTurnedOn') : t('profile.requestEmailsTurnedOff'),
    };
  });
}
