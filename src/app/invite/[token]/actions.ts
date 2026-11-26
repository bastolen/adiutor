/**
 * @file Server actions for accepting an invitation. Their messages are in
 * the request's language.
 */
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import { auth } from '@/lib/auth';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import markActingAsChanged from '@/server/auth/acting-as-changed';
import { getActor } from '@/server/authz';
import { requestStaffName } from '@/server/branding';
import {
  acceptInvitation,
  acceptInvitationWithNewAccount,
  joinedPath,
} from '@/server/people/invitations';

/**
 * Accepts the invitation as the signed-in user and opens the company (or the
 * dashboard after joining the staff).
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `token`.
 * @returns Why it failed; on success, redirects instead.
 */
export async function acceptAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const result = await acceptInvitation(appContext, field(formData, 'token'), actor);
    if (result.status === 'joined') {
      redirect(joinedPath(result.companyId));
    }
    const t = await getTranslations('auth');
    return {
      ok: false,
      message: result.status === 'wrong_account' ? t('invite.wrongAccount') : t('invite.unusable'),
    };
  });
}

/**
 * Creates an account for the invited address, signs in and opens the company
 * (or the dashboard after joining the staff), which loads afresh in every tab
 * of the browser (`markActingAsChanged`).
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `token`, `name` and `password`.
 * @returns Why it failed; on success, redirects instead.
 */
export async function createAccountAction(
  _previous: ActionResult<{ accountExists: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ accountExists: boolean }>> {
  return runAction(async () => {
    const password = field(formData, 'password');
    const result = await acceptInvitationWithNewAccount(appContext, field(formData, 'token'), {
      name: field(formData, 'name'),
      password,
    });
    if (result.status === 'created') {
      await auth.api.signInEmail({
        body: { email: result.email, password },
        headers: await headers(),
      });
      await markActingAsChanged();
      redirect(joinedPath(result.companyId));
    }
    const t = await getTranslations('auth');
    if (result.status === 'account_exists') {
      return { ok: false, message: t('invite.accountExists', { staff: await requestStaffName() }) };
    }
    return { ok: false, message: t('invite.unusable') };
  });
}
