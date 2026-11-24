/**
 * @file For client components that read something only the browser knows,
 * with `useSyncExternalStore`: a subscription for values that never change
 * while the page is shown ({@link noSubscription}), and whether the page has
 * hydrated ({@link useInBrowser}).
 */
'use client';

import { useSyncExternalStore } from 'react';

/**
 * Subscribes to nothing, for `useSyncExternalStore` with a value that doesn't
 * change while the page is shown (a cookie that only changes when the page is
 * left, the tab's history, the browser's time zone): React reads it once
 * when the page hydrates.
 *
 * @returns A function that unsubscribes from nothing.
 */
export function noSubscription(): () => void {
  return () => {};
}

/**
 * Whether the page runs in the browser, hydrated: `false` on the server and
 * while hydrating (so both render the same), then `true`. Forms use it to
 * add what only a browser should get, such as a link's token, which tools
 * that only fetch the page then never see.
 *
 * @returns Whether the page has hydrated in the browser.
 */
export default function useInBrowser(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
