/**
 * @file Saves the browser's time zone with the account the first time
 * someone is signed in, so their times are local from then on. The
 * navigation renders it only for an account without a zone, and never while
 * a staff member is signed in as the user (the browser is theirs). See
 * docs/i18n.md, "Time zones".
 */
'use client';

import { useEffect } from 'react';

import loadFresh, { currentPage } from '@/components/ui/load-fresh';
import { browserTimeZone } from '@/lib/i18n/time-zones';
import useReaderTimeZone from '@/lib/i18n/use-reader-time-zone';

import { saveBrowserTimeZoneAction } from './account/actions';

/**
 * Posts the browser's zone once the page is there. When the account's zone
 * (this one, or one another browser saved first) differs from the zone the
 * page shows, the page loads afresh in it, so every page kept alive shows the
 * new times too. A failure changes nothing: the next page tries again.
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
    saveBrowserTimeZoneAction(zone)
      .then((result) => {
        if (!stale && result.ok && result.data && result.data !== shown) {
          loadFresh(currentPage());
        }
      })
      // Nothing to tell anyone: the times stay in the zone they're in, and the next page tries again.
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [shown]);
  return null;
}
