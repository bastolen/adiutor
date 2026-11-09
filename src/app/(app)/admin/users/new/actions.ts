/**
 * @file Server action for registering a user account.
 */
'use server';

import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field, { localeField } from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { registerUser } from '@/server/people/user-registration';

/**
 * Registers an account for an email address and sends the welcome email. An
 * address that already has an account is reported, with a link to it (staff
 * may see this).
 *
 * @param _previous - The previous result (unused).
 * The success messages come from the `admin.addUser` messages, in the request's language.
 *
 * @param formData - Fields `email` and `locale` (the account's and the welcome email's language).
 * @returns The user and whether they were created, or why it failed.
 */
export default async function registerUserAction(
  _previous: ActionResult<{ userId: string; created: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ userId: string; created: boolean }>> {
  return runAction<{ userId: string; created: boolean }>(async () => {
    const actor = await getActor();
    const email = field(formData, 'email').trim();
    const result = await registerUser(appContext, actor, email, {
      locale: localeField(formData),
    });
    const t = await getTranslations('admin.addUser');
    return result.status === 'created'
      ? {
          ok: true,
          message: t('created', { email }),
          data: { userId: result.userId, created: true },
        }
      : {
          ok: true,
          message: t('existing', { email }),
          data: { userId: result.userId, created: false },
        };
  });
}
