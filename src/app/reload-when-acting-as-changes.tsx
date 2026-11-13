/**
 * @file Loads the page afresh when another tab of this browser says the
 * browser acts as someone else now: it signed in or out, or started or ended
 * a sign-in as a user (`loadFresh` with `everyTab`, over the channel in
 * `src/components/ui/acting-as-channel.ts`). The session is the browser's
 * cookie, so this tab's next navigation would already render for the new
 * person, but its layout (the navigation, the banner and the
 * `SignedInAsMarker` that turns changes off) and the pages Next kept alive
 * would still show the previous one. Mounted in the root layout, so every
 * page listens, the sign-in pages included.
 */
'use client';

import { useEffect, useRef } from 'react';

import { onOtherTabChange } from '@/components/ui/acting-as-channel';
import loadFresh, { currentPage } from '@/components/ui/load-fresh';

/**
 * Loads the current page afresh, once, when another tab says the browser
 * acts as someone else now, also while this tab is hidden: it's up to date
 * before anyone looks at it again, and after a sign-out no tab keeps the
 * previous person's pages. The page then shows what the new person may see
 * there: a signed-out tab goes to the sign-in page (the proxy), a tab on the
 * sign-in page goes on once signed in, and a page the new person can't open
 * says so as it would for anyone. It never tells the other tabs itself.
 *
 * @returns Nothing visible.
 */
export default function ReloadWhenActingAsChanges() {
  const loading = useRef(false);

  useEffect(
    () =>
      onOtherTabChange(() => {
        if (loading.current) {
          return;
        }
        loading.current = true;
        loadFresh(currentPage());
      }),
    [],
  );

  return null;
}
