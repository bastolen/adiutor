/**
 * @file Server action of the dashboard: dismissing the recommendation to add
 * a passkey or two-step verification, saved with the account.
 */
'use server';

import { refresh } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { dismissMfaRecommendation } from '@/server/people/mfa-recommendation';

/**
 * Hides the recommendation for the signed-in user, on every device, and
 * refreshes the dashboard so pages kept alive drop it too.
 *
 * @returns Whether it was saved, or why not.
 */
export default async function dismissMfaRecommendationAction(): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await dismissMfaRecommendation(appContext, actor);
    refresh();
    return { ok: true };
  });
}
