/**
 * @file Server actions for the Profile page of the account (name and email
 * verification). They go through Better Auth, so its rules apply. The
 * Security page's actions are in `./security/actions.ts`.
 */
'use server';

import { isAPIError } from 'better-auth/api';
import { refresh } from 'next/cache';
import { headers } from 'next/headers';

import type { ActionResult } from '@/lib/action-result';
import { auth } from '@/lib/auth';
import field from '@/lib/form-data';
import { nameSchema } from '@/lib/validation';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { assertRateLimit, RATE_LIMITS } from '@/server/rate-limit';

import { VERIFIED_RETURN_PATH } from './account-messages';

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
    await getActor({ allowMissingMfa: true });
    const name = nameSchema.parse(field(formData, 'name'));
    await auth.api.updateUser({ body: { name }, headers: await headers() });
    refresh();
    return { ok: true, message: 'Name saved.' };
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
    if (actor.emailVerified) {
      return { ok: true, message: 'Your email address is already verified.' };
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
        return { ok: false, message: 'Sending the email failed. Please try again.' };
      }
      throw error;
    }
    return {
      ok: true,
      message: `We've sent a verification link to ${actor.email}. It expires in 1 hour.`,
    };
  });
}
