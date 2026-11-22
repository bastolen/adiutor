/**
 * @file Server actions for the Security page of the account: passwords,
 * connected accounts, sign-ins by staff and deactivating the account (signing
 * out devices is on the Activity tab, `activity/actions.ts`). They go
 * through Better Auth or the services, so the guards' rules (session
 * freshness, recent confirmation, the MFA a role requires) apply. When one
 * needs a recent confirmation the user doesn't have, it sends them to the
 * step-up page, which comes back to the form's page and card (its `returnTo`
 * field, `ReturnToField`). Their messages are in the request's language.
 */
'use server';

import { isAPIError } from 'better-auth/api';
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import { auth } from '@/lib/auth';
import { needsRecentConfirmation } from '@/lib/authz/mfa';
import field from '@/lib/form-data';
import { SECURITY_PAGE } from '@/lib/redirect';
import { signInChangeRefusalText } from '@/lib/sign-in/auth-error-messages';
import { confirmChangeUrlFor } from '@/lib/sign-in/confirm-url';
import { MFA_VERIFICATION_REQUIRED } from '@/lib/sign-in/sign-in-refusals';
import { passwordSchema } from '@/lib/validation';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import {
  changeOwnPassword,
  confirmConnectedProvider,
  hasPassword,
  listConnectedProviders,
  setFirstPassword,
} from '@/server/auth/accounts';
import { setStaffSignInAllowed } from '@/server/auth/impersonation';
import { assertNotSignedInAs, getActor } from '@/server/authz';
import { deactivateOwnAccount } from '@/server/people/user-admin';

import { disconnectFailureMessage } from '../account-messages';

/**
 * Sets a first password, or changes the existing one (which needs the
 * current password and signs out other devices). A first password on an
 * account with a second step needs a confirmation with it from the last 15
 * minutes (otherwise the user is sent to confirm first), and without one a
 * sign-in from the last hour: it's a new way to sign in, and on an account
 * whose only second step is GitHub with 2FA it would stop that counting as
 * MFA, so it goes through `setFirstPassword` (Better Auth's `setPassword`
 * never reaches the checks before requests). A change goes through
 * `changeOwnPassword`, which limits and records wrong current passwords
 * (Better Auth's own limiter doesn't run for `auth.api` calls) and words
 * them. Of Better Auth's other errors, the refusals of a sign-in change keep
 * their message, a session that ended meanwhile is sent to sign in again,
 * and anything else (e.g. a first password set in another tab meanwhile) is
 * a general failure, never blamed on the current password.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `newPassword`, `confirmation` and, when changing, `currentPassword`.
 * @returns A confirmation, or why it failed.
 */
export async function passwordAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    // Before the confirmation below, which would otherwise send a staff member signed in as the user to it.
    assertNotSignedInAs(actor);
    const newPassword = passwordSchema.parse(field(formData, 'newPassword'));
    const t = await getTranslations('account');
    if (newPassword !== field(formData, 'confirmation')) {
      return { ok: false, message: t('security.password.mismatch') };
    }

    const changing = await hasPassword(appContext.db, actor.id);
    if (!changing && needsRecentConfirmation(actor)) {
      redirect(confirmChangeUrlFor(formData, SECURITY_PAGE));
    }

    const requestHeaders = await headers();
    try {
      if (changing) {
        await changeOwnPassword(appContext, actor, () =>
          auth.api.changePassword({
            body: {
              currentPassword: field(formData, 'currentPassword'),
              newPassword,
              revokeOtherSessions: true,
            },
            headers: requestHeaders,
          }),
        );
      } else {
        // Better Auth's `setPassword` is server-only: the service applies the guards' rules to it.
        await setFirstPassword(appContext, actor, () =>
          auth.api.setPassword({ body: { newPassword }, headers: requestHeaders }),
        );
      }
    } catch (error) {
      if (isAPIError(error)) {
        const refusal = signInChangeRefusalText(await getTranslations('auth'), error.body?.code);
        if (refusal) {
          return { ok: false, message: refusal };
        }
        // The session ended while the request was under way: sign in again, as `getActor` does.
        if (error.status === 'UNAUTHORIZED') {
          redirect('/auth');
        }
        return { ok: false, message: t('security.password.failed') };
      }
      throw error;
    }
    refresh();
    return { ok: true, message: t('security.password.saved') };
  });
}

/**
 * Confirms a GitHub or Google account that was connected while signing in
 * with it, so it counts as a second step. Without a recent confirmation with
 * the existing second step, it sends the user to confirm first.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Form data with `accountId`.
 * @returns The result.
 */
export async function confirmProviderAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    assertNotSignedInAs(actor);
    if (needsRecentConfirmation(actor)) {
      redirect(confirmChangeUrlFor(formData, SECURITY_PAGE));
    }
    await confirmConnectedProvider(appContext, actor, field(formData, 'accountId'));
    refresh();
    const t = await getTranslations('account');
    return { ok: true, message: t('security.connected.confirmed') };
  });
}

/**
 * Disconnects a GitHub or Google account from the signed-in user. Better Auth
 * requires a recent sign-in for this, and the guards a recent confirmation
 * with the second step, if the account has one; without it, the user is sent
 * to confirm first.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `accountId`: the connected account's row ID.
 * @returns Success, or why it failed.
 */
export async function disconnectAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    // Better Auth would act on the session's own user: a staff member signed in as someone.
    assertNotSignedInAs(actor);
    const accountId = field(formData, 'accountId');
    const [connected, t, tAuth] = await Promise.all([
      listConnectedProviders(appContext, actor.id),
      getTranslations('account'),
      getTranslations('auth'),
    ]);
    if (!connected.some((item) => item.id === accountId)) {
      return { ok: false, message: t('security.connected.noLongerConnected') };
    }

    try {
      await auth.api.unlinkAccount({ body: { accountId }, headers: await headers() });
    } catch (error) {
      if (isAPIError(error)) {
        if (error.body?.code === MFA_VERIFICATION_REQUIRED.code) {
          redirect(confirmChangeUrlFor(formData, SECURITY_PAGE));
        }
        return { ok: false, message: disconnectFailureMessage(t, tAuth, error.body?.code) };
      }
      throw error;
    }
    refresh();
    return { ok: true };
  });
}

/**
 * Deactivates the signed-in user's own account and signs them out. Only an
 * Admin can reactivate it. Like changing how they sign in, it needs a recent
 * confirmation with the second step, if the account has one (otherwise the
 * user is sent to confirm first), and without a password or a second step a
 * sign-in from the last hour (`deactivateOwnAccount`). On success the card's
 * dialog loads the sign-in page afresh, in this tab and the browser's others
 * (`loadOnSuccess`): a redirect from here would be a navigation within the
 * app, keeping this person's pages alive and the other tabs unaware.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `password` (when the user has one).
 * @returns Whether it worked, and if not why.
 */
export async function deactivateAccountAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    assertNotSignedInAs(actor);
    if (needsRecentConfirmation(actor)) {
      redirect(confirmChangeUrlFor(formData, SECURITY_PAGE));
    }
    await deactivateOwnAccount(appContext, actor, field(formData, 'password'));
    // The sessions are gone already; this clears the cookies in the browser too.
    await auth.api.signOut({ headers: await headers() }).catch(() => undefined);
    return { ok: true };
  });
}

/**
 * Turns sign-ins by staff on or off for the user's own account
 * (`setStaffSignInAllowed`). Turning it off ends a sign-in as them that's
 * under way.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `allowed`: `true` to turn it on, `false` to turn it off.
 * @returns A confirmation.
 */
export async function staffSignInAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    const allowed = field(formData, 'allowed') === 'true';
    await setStaffSignInAllowed(appContext, actor, allowed);
    refresh();
    const t = await getTranslations('account');
    return {
      ok: true,
      message: allowed ? t('security.staffSignIn.turnedOn') : t('security.staffSignIn.turnedOff'),
    };
  });
}
