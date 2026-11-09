/**
 * @file Server actions for using an invite link. Their messages are in the
 * request's language.
 */
'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import { emailSchema } from '@/lib/validation';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { joinedPath } from '@/server/people/invitations';
import { claimInviteLink, joinWithInviteLink } from '@/server/people/invite-links';

/**
 * Uses the link with an email address: an invitation is emailed to it. The
 * message is the same whatever the address.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `token` and `email`.
 * @returns A confirmation, or why it failed.
 */
export async function claimAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const email = emailSchema.parse(field(formData, 'email'));
    const result = await claimInviteLink(appContext, field(formData, 'token'), email);
    const t = await getTranslations('auth');
    return result.status === 'sent'
      ? { ok: true, message: t('join.sent', { email }) }
      : { ok: false, message: t('join.unusable') };
  });
}

/**
 * Uses the link to join as the signed-in user, then opens the company (or the
 * dashboard after joining the staff). When the new role requires MFA and
 * this session wasn't confirmed with it, joining ended the session, so the
 * user goes to sign in again with a note.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `token`.
 * @returns Why it failed; on success, redirects instead.
 */
export async function joinAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const result = await joinWithInviteLink(appContext, field(formData, 'token'), actor);
    if (result.status === 'joined' && result.signedOut) {
      // The new role requires MFA, and a link proves no inbox: this session ended.
      const next = encodeURIComponent(joinedPath(result.companyId));
      redirect(`/auth?notice=joined-mfa-required&callbackURL=${next}`);
    }
    if (result.status === 'joined') {
      redirect(joinedPath(result.companyId));
    }
    const t = await getTranslations('auth');
    return { ok: false, message: t('join.unusable') };
  });
}
