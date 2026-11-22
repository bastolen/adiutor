/**
 * @file Server actions for the Activity tab of the account: signing out on
 * one of the user's other devices, or on all of them but this one. Their
 * messages are in the request's language.
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { revokeOtherOwnSessions, revokeOwnSession } from '@/server/auth/sessions';
import { getActor } from '@/server/authz';

/**
 * Signs the user out on one of their other devices.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `sessionId`.
 * @returns A confirmation, or why it failed.
 */
export async function revokeSessionAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    await revokeOwnSession(appContext, actor, field(formData, 'sessionId'));
    refresh();
    const t = await getTranslations('account');
    return { ok: true, message: t('security.sessions.signedOut') };
  });
}

/**
 * Signs the user out on every device except this one.
 *
 * @returns A confirmation.
 */
export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor({ allowMissingMfa: true });
    const count = await revokeOtherOwnSessions(appContext, actor);
    refresh();
    const t = await getTranslations('account');
    return { ok: true, message: t('security.sessions.signedOutOthers', { count }) };
  });
}
