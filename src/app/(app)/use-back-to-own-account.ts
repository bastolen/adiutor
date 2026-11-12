/**
 * @file Goes back from signing in as a user to the staff member's own account,
 * for the banner's button and the account menu.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { useToast } from '@/components/ui/toast';
import { DEFAULT_SIGNED_IN_PATH } from '@/lib/redirect';

import backToOwnAccountAction from './impersonation-actions';

/**
 * Ends signing in as a user, then opens the page the staff member started
 * from and confirms it with a toast. The toast survives the navigation: the
 * signed-in app's `Toaster` is in the layout, which stays.
 *
 * @returns `goBack` to start it, and `pending` while it runs.
 */
export default function useBackToOwnAccount(): { goBack: () => void; pending: boolean } {
  const router = useRouter();
  const showToast = useToast();
  const [pending, startTransition] = useTransition();

  /** Ends it, then goes back. */
  const goBack = () => {
    startTransition(async () => {
      const result = await backToOwnAccountAction();
      if (result.ok && result.message) {
        showToast?.(result.message);
      }
      router.replace((result.ok && result.data?.returnTo) || DEFAULT_SIGNED_IN_PATH);
      router.refresh();
    });
  };

  return { goBack, pending };
}
