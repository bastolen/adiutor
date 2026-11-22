/**
 * @file Saves the browser's time zone with the account the first time
 * someone is signed in, so their times are local from then on. The
 * navigation renders it only for an account without a zone, and never while
 * a staff member is signed in as the user (the browser is theirs). It saves
 * only on a page that stays, never on one a fresh load is replacing. See
 * docs/i18n.md, "Time zones".
 */
'use client';

import { useEffect } from 'react';

import loadFresh, { currentPage, freshLoadStarted } from '@/components/ui/load-fresh';
import { browserTimeZone } from '@/lib/i18n/time-zones';
import useReaderTimeZone from '@/lib/i18n/use-reader-time-zone';

import { saveBrowserTimeZoneAction } from './account/actions';

/**
 * Posts the browser's zone once the page is there, and only when it stays:
 * not on a page that has started to load afresh (`freshLoadStarted`), as the
 * first page after signing up does once the browser acts as the new account
 * (`ReloadWhenActingAsChanges`). A save there would be cut off by the load,
 * possibly after the account got the zone but before this browser got its
 * cookie, and its own fresh load would merge with the one under way; the
 * page that replaces it saves the zone instead. That load can start in an
 * effect of the same commit that runs after this one (the root layout's), so
 * the save waits until the commit's effects have run.
 *
 * When the account's zone (this one, or one another browser saved first)
 * differs from the zone the page shows, the page loads afresh in it, so every
 * page kept alive shows the new times too. A failure changes nothing: the
 * next page tries again.
 *
 * @returns Nothing visible.
 */
export default function SaveBrowserTimeZone() {
  const shown = useReaderTimeZone();
  useEffect(() => {
    const zone = browserTimeZone();
    if (!zone) {
      return undefined;
    }
    let stale = false;
    // After the commit's other effects: a parent's effects run after its children's.
    const timer = window.setTimeout(() => {
      if (freshLoadStarted()) {
        return;
      }
      saveBrowserTimeZoneAction(zone)
        .then((result) => {
          if (!stale && result.ok && result.data && result.data !== shown) {
            loadFresh(currentPage());
          }
        })
        // Nothing to tell anyone: the times stay in the zone they're in, and the next page tries
        // again.
        .catch(() => undefined);
    }, 0);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [shown]);
  return null;
}
