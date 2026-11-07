/**
 * @file Server action for registering a user account.
 */
'use server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
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
 * @param formData - Field `email`.
 * @returns The user and whether they were created, or why it failed.
 */
export default async function registerUserAction(
  _previous: ActionResult<{ userId: string; created: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ userId: string; created: boolean }>> {
  return runAction<{ userId: string; created: boolean }>(async () => {
    const actor = await getActor();
    const email = field(formData, 'email').trim();
    const result = await registerUser(appContext, actor, email);
    return result.status === 'created'
      ? {
          ok: true,
          message: `Account created for ${email}. We've emailed them a link to choose a password.`,
          data: { userId: result.userId, created: true },
        }
      : {
          ok: true,
          message: `${email} already has an account. Nothing was changed.`,
          data: { userId: result.userId, created: false },
        };
  });
}
