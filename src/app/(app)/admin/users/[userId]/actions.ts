/**
 * @file Server actions for the user detail page's account actions
 * (two-step verification, sign-out, deactivating and deleting) and for
 * signing in as the user; memberships
 * use `src/app/(app)/_people/member-actions.ts` and the staff role
 * `src/app/(app)/_people/staff-actions.ts`. Each one checks the session and
 * lets the service check permissions, then refreshes the page. Success
 * messages come from the `admin.user.actions` messages.
 */
'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import { isMfaConfirmedRecently, needsRecentConfirmation } from '@/lib/authz/mfa';
import field from '@/lib/form-data';
import { DEFAULT_SIGNED_IN_PATH } from '@/lib/redirect';
import { confirmChangeUrlFor, confirmStrongUrlFor } from '@/lib/sign-in/confirm-url';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { startImpersonation } from '@/server/auth/impersonation';
import { assertNotSignedInAs, getActor } from '@/server/authz';
import { parseId } from '@/server/errors';
import {
  deactivateUser,
  deleteUser,
  reactivateUser,
  resetUserMfa,
  signOutUserEverywhere,
} from '@/server/people/user-admin';

/**
 * Turns off a user's two-step verification, optionally removing passkeys,
 * and disconnects their GitHub and Google accounts (`resetUserMfa`). It needs
 * a confirmation with the Admin's own second step from the last 15 minutes;
 * without one, the Admin is sent to confirm first and comes back to the
 * user's page, to the card the form is in (its `returnTo` field).
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `userId` and `removePasskeys` (checkbox).
 * @returns A confirmation, or why it failed.
 */
export async function resetMfaAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    // Before the confirmation, which would otherwise send a staff member signed in as someone to it.
    assertNotSignedInAs(actor);
    const userId = field(formData, 'userId');
    if (needsRecentConfirmation(actor)) {
      // Back to the form's page and card; without one, to the user's page (only an ID goes in).
      redirect(confirmChangeUrlFor(formData, `/admin/users/${parseId(userId)}`));
    }
    await resetUserMfa(appContext, actor, userId, {
      removePasskeys: formData.get('removePasskeys') === 'on',
    });
    refresh();
    const t = await getTranslations('admin.user.actions');
    return { ok: true, message: t('mfaReset') };
  });
}

/**
 * Signs a user out on every device.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `userId`.
 * @returns A confirmation, or why it failed.
 */
export async function signOutEverywhereAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await signOutUserEverywhere(appContext, actor, field(formData, 'userId'));
    refresh();
    const t = await getTranslations('admin.user.actions');
    return { ok: true, message: t('signedOut') };
  });
}

/**
 * Deactivates a user's account.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `userId`.
 * @returns A confirmation, or why it failed.
 */
export async function deactivateUserAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await deactivateUser(appContext, actor, field(formData, 'userId'));
    refresh();
    const t = await getTranslations('admin.user.actions');
    return { ok: true, message: t('deactivated') };
  });
}

/**
 * Reactivates a user's account.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `userId`.
 * @returns A confirmation, or why it failed.
 */
export async function reactivateUserAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await reactivateUser(appContext, actor, field(formData, 'userId'));
    refresh();
    const t = await getTranslations('admin.user.actions');
    return { ok: true, message: t('reactivated') };
  });
}

/**
 * Deletes a user's account, then returns to the users list.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `userId` and `confirmEmail`.
 * @returns Why it failed (on success it redirects).
 */
export async function deleteUserAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const result = await runAction(async () => {
    const actor = await getActor();
    await deleteUser(appContext, actor, field(formData, 'userId'), field(formData, 'confirmEmail'));
    return { ok: true };
  });
  if (result.ok) {
    redirect('/admin/users?deleted=1');
  }
  return result;
}

/**
 * Signs in as a user (`startImpersonation`), then opens the dashboard as
 * them. It needs a confirmation with the staff member's strong second step
 * from the last 15 minutes, whatever their role; without one, they're sent
 * to the step-up page in its strong mode first and come back to the card
 * (its `returnTo` field), which is also where "Back to my account" returns.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `userId`, `reason` (optional) and `returnTo`.
 * @returns Why it failed (on success it redirects).
 */
export async function signInAsAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const result = await runAction(async () => {
    const actor = await getActor();
    // Before the confirmation, which would otherwise send a staff member signed in as someone to it.
    assertNotSignedInAs(actor);
    const userId = field(formData, 'userId');
    // Only an account with strong MFA can confirm; without it, the service says what's missing.
    if (actor.strongMfa && !isMfaConfirmedRecently(actor.strongMfaConfirmedUntil)) {
      redirect(confirmStrongUrlFor(formData, `/admin/users/${parseId(userId)}`));
    }
    await startImpersonation(appContext, actor, {
      userId,
      reason: field(formData, 'reason'),
      returnTo: field(formData, 'returnTo'),
    });
    return { ok: true };
  });
  if (result.ok) {
    // The whole app now shows the user, the layout too (the banner, the account menu), which a
    // redirect alone keeps as it was.
    refresh();
    redirect(DEFAULT_SIGNED_IN_PATH);
  }
  return result;
}
