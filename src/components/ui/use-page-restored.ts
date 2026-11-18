/**
 * @file A hook for forms that hand the browser over to another page: it runs
 * a reset when the browser shows the page again from its back/forward cache.
 */
'use client';

import { useEffect, useEffectEvent } from 'react';

/**
 * Calls `reset` when the browser restores this page from its back/forward
 * cache (a `pageshow` event with `persisted` set, e.g. Back from a provider's
 * sign-in page). A restored page keeps its state, so a button that went busy
 * before the browser left would otherwise stay busy. The listener is added
 * once, whatever `reset` is on later renders, and removed when the component
 * unmounts.
 *
 * @param reset - Makes the form usable again; may change on every render (the latest one runs).
 */
export function usePageRestored(reset: () => void) {
  const resetNow = useEffectEvent(reset);
  useEffect(() => {
    /**
     * Resets when the page comes from the cache, not when it loads.
     *
     * @param event - The page being shown.
     */
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        resetNow();
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);
}
