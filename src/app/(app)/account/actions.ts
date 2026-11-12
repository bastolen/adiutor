/**
 * @file Server actions for the Profile page of the account (name, language
 * and email verification). They go through Better Auth, so its rules apply. Their
 * messages are in the request's language. The Security page's actions are in
 * `./security/actions.ts`.
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
import { withSection } from '@/lib/redirect';
import { nameSchema } from '@/lib/validation';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { assertNotSignedInAs, getActor } from '@/server/authz';
import setOwnLocale from '@/server/people/own-locale';
import { assertRateLimit, RATE_LIMITS } from '@/server/rate-limit';

import { LANGUAGE_SECTION, VERIFIED_RETURN_PATH } from './account-messages';

/** Where the page reloads after the language changed, to say so in it (`?language=saved`). */
const LANGUAGE_SAVED_PATH = withSection('/account?language=saved', LANGUAGE_SECTION);

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
