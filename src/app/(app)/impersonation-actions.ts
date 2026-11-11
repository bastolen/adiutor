/**
 * @file The server action that ends signing in as a user: "Back to my
 * account", in the banner and in the account menu (where it takes Sign out's
 * place while signed in as someone). It's the one change that works from the
 * user's view, since it changes nothing of theirs.
 */
'use server';

import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import { getSafeRedirectPath } from '@/lib/redirect';
import { stopSigningInAs } from '@/server/authz';

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
