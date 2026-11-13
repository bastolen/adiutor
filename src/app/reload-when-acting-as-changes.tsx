/**
 * @file Keeps the browser's tabs in step with whoever the browser acts as.
 * When another tab says the browser acts as someone else now (it signed in
 * or out, or started or ended a sign-in as a user: `loadFresh` with
 * `everyTab`, over the channel in `src/components/ui/acting-as-channel.ts`),
 * this tab loads its page afresh. The session is the browser's cookie, so
 * this tab's next navigation would already render for the new person, but
 * its layout (the navigation, the banner and the `SignedInAsMarker` that
 * turns changes off) and the pages Next kept alive would still show the
 * previous one.
 *
 * A change that ends in a redirect can't tell the other tabs from the page
 * that made it, so the server leaves the next page a cookie instead
 * (`ACTING_AS_CHANGED_COOKIE`): after a sign-in that came back through a
 * redirect (a provider, an email link), and from a server action that signs
 * someone in or out and redirects (`markActingAsChanged`). The page that
 * loads with it, or that a navigation within the app reaches with it,
 * removes it and tells them; after such a navigation, this tab loads afresh
 * too.
 *
 * Mounted in the root layout, so every page listens, the sign-in pages
 * included.
 */
'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { clearNextPageCookie } from '@/components/auth/use-next-page-cookie';
import { onOtherTabChange, tellOtherTabs } from '@/components/ui/acting-as-channel';
import loadFresh, { currentPage } from '@/components/ui/load-fresh';
import { cookieValue } from '@/lib/request/cookie-value';
import { ACTING_AS_CHANGED_COOKIE } from '@/lib/sign-in/auth-cookies';

/**
 * Loads the current page afresh, once, when another tab says the browser
 * acts as someone else now, also while this tab is hidden: it's up to date
 * before anyone looks at it again, and after a sign-out no tab keeps the
 * previous person's pages. The page then shows what the new person may see
 * there: a signed-out tab goes to the sign-in page (the proxy), a tab on the
 * sign-in page goes on once signed in, and a page the new person can't open
 * says so as it would for anyone. It never tells the other tabs in turn.
 *
 * When the page loads with {@link ACTING_AS_CHANGED_COOKIE}, it removes the
 * cookie and tells the other tabs: this page is a full load already. When a
 * navigation within the app (a server action's redirect) reaches a page with
 * it, it removes it and loads that page afresh in this tab and the others
 * (`loadFresh` with `everyTab`), so no page Next kept alive from before stays
 * in this tab either.
 *
 * @returns Nothing visible.
 */
export default function ReloadWhenActingAsChanges() {
  const pathname = usePathname();
  const loading = useRef(false);
  // Whether the page this tab loaded with is still the one shown, before any navigation.
  const firstPage = useRef(true);

  useEffect(() => {
    const loadedWithIt = firstPage.current;
    firstPage.current = false;
    if (loading.current || cookieValue(document.cookie, ACTING_AS_CHANGED_COOKIE) === null) {
      return;
    }
    clearNextPageCookie(ACTING_AS_CHANGED_COOKIE);
    if (loadedWithIt) {
      tellOtherTabs();
      return;
    }
    loading.current = true;
    loadFresh(currentPage(), { everyTab: true });
  }, [pathname]);

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
