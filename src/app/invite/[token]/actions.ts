/**
 * @file Server actions for accepting an invitation.
 */
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/action-result';
import { auth } from '@/lib/auth';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import {
  acceptInvitation,
  acceptInvitationWithNewAccount,
  joinedPath,
} from '@/server/people/invitations';

/** Message for an invitation that stopped working in the meantime. */
const UNUSABLE = 'This invitation can no longer be used. Ask for a new one.';

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
    return {
      ok: false,
      message:
        result.status === 'wrong_account'
          ? 'This invitation is for a different account. Sign out, then open the link again.'
          : UNUSABLE,
    };
  });
}

/**
 * Creates an account for the invited address, signs in and opens the company
 * (or the dashboard after joining the staff).
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
      redirect(joinedPath(result.companyId));
    }
    if (result.status === 'account_exists') {
      return {
        ok: false,
        message: 'You already have an Adiutor account. Sign in to accept the invitation.',
      };
    }
    return { ok: false, message: UNUSABLE };
  });
}
