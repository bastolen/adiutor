/**
 * @file Brings the entry of a request's activity that the address points at
 * (`#entry-<entry ID>`, as the emails about a request link) into view when
 * the page opens. Next.js scrolls to an anchor itself only when the element
 * is already on the page, and the activity streams in after it, and it never
 * moves focus.
 */
'use client';

import { useEffect } from 'react';

import { focusIsLost, isShown } from '@/components/ui/focus-fallback';
import { sectionFromHash } from '@/lib/redirect';
import { isEntryAnchor } from '@/lib/requests';

/**
 * On arrival (when the activity mounts, or when the page is shown again from
 * `<Activity>`, which runs effects again), one frame after the page has
 * settled, and only while the address names an entry that's on the page,
 * like `AnchoredSection` does for a card:
 * - with focus nowhere in particular, it scrolls the entry into view (below
 *   the sticky header, by the page's `scroll-padding-top` and the entry's own
 *   `scroll-margin-top`) and focuses it, so a screen reader starts there;
 * - with focus already inside it, it only scrolls it into view;
 * - with focus anywhere else, it leaves the page alone.
 *
 * The page shows the conversation down to the entry an address names (the
 * request's `?entry=`), so it's there however far back it is, up to every
 * chunk a reader can add (`MAX_EARLIER_CHUNKS`). An entry further back than
 * that, or one the reader may not see, isn't there, so the page opens as
 * usual.
 *
 * @returns Nothing: it only acts.
 */
export default function EntryOnArrival() {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const anchor = sectionFromHash(window.location.hash);
      const entry = isEntryAnchor(anchor) ? document.getElementById(anchor) : null;
      if (!entry || !isShown(entry)) {
        return;
      }
      if (focusIsLost()) {
        entry.scrollIntoView({ block: 'start' });
        entry.focus({ preventScroll: true });
      } else if (entry.contains(document.activeElement)) {
        entry.scrollIntoView({ block: 'start' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return null;
}
