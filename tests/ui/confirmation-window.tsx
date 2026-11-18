/**
 * @file A harness for unit tests of cards and forms that need a recent
 * confirmation with the second step: it provides the confirmation window, open
 * or run out, the way a page that requires one does.
 */
import { type ReactNode, useState } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';

/**
 * Provides a required confirmation window to the cards and forms inside it,
 * measured from the time it renders.
 *
 * @param props - Harness props.
 * @param props.windowOpen - Whether the confirmation window is still open (ten minutes left) or has run out.
 * @param props.returnTo - The page to come back to after confirming.
 * @param props.children - The cards and forms.
 * @returns The provider.
 */
export default function ConfirmationWindow({
  windowOpen,
  returnTo,
  children,
}: {
  windowOpen: boolean;
  returnTo: string;
  children: ReactNode;
}) {
  const [serverTime] = useState(() => Date.now());
  return (
    <RecentConfirmationProvider
      required
      confirmedUntil={windowOpen ? serverTime + 10 * 60 * 1000 : null}
      serverTime={serverTime}
      returnTo={returnTo}
    >
      {children}
    </RecentConfirmationProvider>
  );
}
