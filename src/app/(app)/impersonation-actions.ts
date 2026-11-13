/**
 * @file The server actions while signed in as a user. "Back to my account"
 * ends it, in the banner and in the account menu (where it takes Sign out's
 * place while signed in as someone). It's the one change that works from the
 * user's view, since it changes nothing of theirs. The banner also asks after
 * each navigation within the app whether it still lasts.
 */
'use server';

import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import { getSafeRedirectPath } from '@/lib/redirect';
import { getOptionalActor, stopSigningInAs } from '@/server/authz';

/**
 * Ends signing in as a user (`stopSigningInAs`, recorded as
 * `impersonation_ended` with `stopped`) and says where to go back to: the
 * page the staff member started from, usually the user's page at the card's
 * anchor. Ending one that's over already goes to the dashboard.
 *
 * @returns Where to go, and the message to show there.
 */
export default async function backToOwnAccountAction(): Promise<
  ActionResult<{ returnTo: string }>
> {
  const ended = await stopSigningInAs();
  const t = await getTranslations('navigation.signedInAs');
  return {
    ok: true,
    message: t('backDone'),
    data: { returnTo: getSafeRedirectPath(ended?.returnTo) },
  };
}

/**
 * Says when the session's sign-in as someone ends, for the banner's check
 * after a navigation within the app (`ReloadWhenSignedInAsEnds`). A
 * different answer than the banner's, or none, means it's over (the rules no
 * longer allow it, or its time is up) or another tab started a new one, and
 * the tab loads afresh. It changes nothing itself: `getOptionalActor` ends
 * one that's over, as on every request.
 *
 * @returns When it ends (ISO), or `null` when the session isn't signed in as anyone.
 */
export async function signedInAsEndsAtAction(): Promise<string | null> {
  const actor = await getOptionalActor();
  return actor?.signedInAs?.endsAt.toISOString() ?? null;
}
