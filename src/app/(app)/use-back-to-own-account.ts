/**
 * @file Goes back from signing in as a user to the staff member's own account,
 * for the banner's button and the account menu.
 */
'use client';

import { useTransition } from 'react';

import loadFresh from '@/components/ui/load-fresh';
import { showToastAfterLoad } from '@/components/ui/toast';
import { useTransientState } from '@/components/ui/use-transient-state';
import { DEFAULT_SIGNED_IN_PATH } from '@/lib/redirect';

import backToOwnAccountAction from './impersonation-actions';

/**
 * Ends signing in as a user, then loads the page the staff member started
 * from afresh (`loadFresh`), where a toast confirms it
 * (`showToastAfterLoad`). A navigation within the app would keep the pages
 * Next kept alive while signed in as the user, with the user's values in
 * their fields. The browser's other tabs load their own page afresh too
 * (`everyTab`), as the staff member.
 *
 * @returns `goBack` to start it, and `pending` while it runs and until the page goes.
 */
export default function useBackToOwnAccount(): { goBack: () => void; pending: boolean } {
  const [running, startTransition] = useTransition();
  // Set once it has ended, so the button stays busy until the page goes.
  const [leaving, setLeaving] = useTransientState(false);

  /** Ends it, then goes back. */
  const goBack = () => {
    startTransition(async () => {
      const result = await backToOwnAccountAction();
      if (result.ok && result.message) {
        showToastAfterLoad(result.message);
      }
      setLeaving(true);
      loadFresh((result.ok && result.data?.returnTo) || DEFAULT_SIGNED_IN_PATH, {
        everyTab: true,
      });
    });
  };

  return { goBack, pending: running || leaving };
}
