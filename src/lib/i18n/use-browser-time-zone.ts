/**
 * @file The zone the browser itself is set to, for client components that
 * offer it or send it (the Profile page's Time zone card, setup). Unknown
 * until the page has hydrated, so the server's page and the browser's first
 * render agree.
 */
'use client';

import { useSyncExternalStore } from 'react';

import { browserTimeZone } from './time-zones';

/**
 * Nothing to subscribe to: the browser's zone doesn't change while the page
 * is open (a change shows on the next page load).
 *
 * @returns A function that unsubscribes from nothing.
 */
function subscribeToNothing() {
  return () => undefined;
}

/**
 * The browser's zone on the server and while hydrating: unknown.
 *
 * @returns `null`.
 */
function unknownZone(): string | null {
  return null;
}

/**
 * Reads the browser's zone (`browserTimeZone`) once the page has hydrated.
 *
 * @returns The zone, e.g. `Europe/Amsterdam`, or `null` before hydration and
 *   when the browser reports none Adiutor accepts.
 */
export default function useBrowserTimeZone(): string | null {
  return useSyncExternalStore(subscribeToNothing, browserTimeZone, unknownZone);
}
