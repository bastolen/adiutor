/**
 * @file Server action for first-run setup.
 */
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/action-result';
import { auth } from '@/lib/auth';
import field from '@/lib/form-data';
import requestLocale from '@/lib/i18n/request-locale';
import { DEFAULT_SIGNED_IN_PATH } from '@/lib/redirect';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { setUpPlatform } from '@/server/setup';

/**
 * Names the staff, sets Adiutor's default language and creates its first
 * Admin, in the language the setup page was shown in (their browser's, as
 * nothing is set up yet), then signs them in and opens the dashboard. Only on a fresh install: refused once setup is done or any
 * account exists, even if the form is posted directly, so it never promotes
 * an existing account.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `staffName`, `defaultLocale`, `name`, `email` and `password`.
 * @returns Why it failed; on success, redirects instead.
 */
export default async function setupAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const password = field(formData, 'password');
    const result = await setUpPlatform(appContext, {
      staffName: field(formData, 'staffName'),
      defaultLocale: field(formData, 'defaultLocale'),
      adminLocale: await requestLocale(),
      name: field(formData, 'name'),
      email: field(formData, 'email'),
      password,
    });
    await auth.api.signInEmail({
      body: { email: result.email, password },
      headers: await headers(),
    });
    redirect(DEFAULT_SIGNED_IN_PATH);
  });
}
