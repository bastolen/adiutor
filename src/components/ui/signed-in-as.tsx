/**
 * @file Whether a staff member is signed in as the user in this tab ("Sign in
 * as", see docs/decisions/0017-staff-sign-in-as-users.md), for the controls
 * that change something: they render disabled while it lasts, since the
 * server refuses every change then (`assertNotSignedInAs`). The banner
 * (`SignedInAsBanner`, in the signed-in app's layout) mounts
 * {@link SignedInAsMarker}, and controls read {@link useSignedInAs}.
 *
 * A small store outside React, like the toasts' (`useToast`): a provider
 * around every page would have to read the session in the layout, which
 * keeps pages out of their static shell. The server renders the controls as
 * usual (the marker isn't mounted there yet); the browser disables them as
 * soon as the banner arrives, and the server refuses a change either way.
 */
'use client';

import { useEffect, useSyncExternalStore } from 'react';

/** How many markers are mounted: one while the banner shows. */
let mountedMarkers = 0;

/** Components to re-render when that changes. */
const listeners = new Set<() => void>();

/**
 * Subscribes a component to changes of {@link mountedMarkers}.
 *
 * @param listener - Called on every change.
 * @returns The unsubscribe function.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells every subscribed component that the state changed. */
function notify(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Marks the tab as signed in as someone while it's mounted. Rendered by the
 * banner, so it goes away with it ("Back to my account", or an end).
 *
 * @returns Nothing visible.
 */
export function SignedInAsMarker() {
  useEffect(() => {
    mountedMarkers += 1;
    notify();
    return () => {
      mountedMarkers -= 1;
      notify();
    };
  }, []);
  return null;
}

/**
 * Whether a staff member is signed in as the user, so changes are turned
 * off: `false` on the server and until the banner has mounted its marker.
 *
 * @returns Whether controls that change something should render disabled.
 */
export function useSignedInAs(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mountedMarkers > 0,
    () => false,
  );
}
