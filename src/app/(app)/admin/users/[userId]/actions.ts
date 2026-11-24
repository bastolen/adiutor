/**
 * @file Server actions for the account actions on a user's page
 * (two-step verification, sign-out, deactivating, reactivating and deleting) and for
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

import confirmFirstIfNeeded from '../../../_people/confirm-grant';

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
      // Back to the form's page and card; without one, to the user's Manage tab (only an ID goes in).
      redirect(confirmChangeUrlFor(formData, `/admin/users/${parseId(userId)}/manage`));
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
 * Reactivates a user's account (`reactivateUser`). One that kept a staff
 * role or a company's Admin role gets it back, which needs a confirmation
 * with the Admin's own second step from the last 15 minutes, like giving the
 * role anew: when the service refuses for lack of one, the Admin is sent to
 * confirm first and comes back to the user's page, to the card the button is
 * in (its `returnTo` field). The card asks before that, when it can tell.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `userId` and `returnTo`.
 * @returns A confirmation, or why it failed.
 */
export async function reactivateUserAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const userId = field(formData, 'userId');
    // Without a `returnTo`, back to the user's Manage tab (only an ID goes in).
    await confirmFirstIfNeeded(formData, `/admin/users/${parseId(userId)}/manage`, () =>
      reactivateUser(appContext, actor, userId),
    );
    refresh();
    const t = await getTranslations('admin.user.actions');
    return { ok: true, message: t('reactivated') };
  });
}

/**
 * Deletes a user's account, then returns to the users list. It refreshes
 * before it redirects: Next drops the pages it kept alive only for an action
 * that refreshes, so without it Back would show the deleted user's page as
 * it was, with controls that seem to work.
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
    refresh();
    redirect('/admin/users?deleted=1');
  }
  return result;
}

/**
 * Signs in as a user (`startImpersonation`). It needs a confirmation with the
 * staff member's strong second step from the last 15 minutes, whatever their
 * role; without one, they're sent to the step-up page in its strong mode
 * first and come back to the card (its `returnTo` field), which is also where
 * "Back to my account" returns. On success the card's dialog loads the
 * dashboard afresh (`loadOnSuccess`): a navigation within the app would keep
 * the pages Next kept alive, with the staff member's own values in their
 * fields.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `userId`, `reason` (optional) and `returnTo`.
 * @returns Whether it started, and if not why.
 */
export async function signInAsAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    // Before the confirmation, which would otherwise send a staff member signed in as someone to it.
    assertNotSignedInAs(actor);
    const userId = field(formData, 'userId');
    // Only an account with strong MFA can confirm; without it, the service says what's missing.
    if (actor.strongMfa && !isMfaConfirmedRecently(actor.strongMfaConfirmedUntil)) {
      redirect(confirmStrongUrlFor(formData, `/admin/users/${parseId(userId)}/manage`));
    }
    await startImpersonation(appContext, actor, {
      userId,
      reason: field(formData, 'reason'),
      returnTo: field(formData, 'returnTo'),
    });
    return { ok: true };
  });
}
