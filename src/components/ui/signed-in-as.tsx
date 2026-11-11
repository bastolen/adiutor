/**
 * @file Whether a staff member is signed in as the user in this tab ("Sign in
 * as", see docs/decisions/0017-staff-sign-in-as-users.md), for the controls
 * that change something: they render disabled while it lasts, since the
 * server refuses every change then (`assertNotSignedInAs`). The banner
 * (`SignedInAsBanner`, in the signed-in app's layout) mounts
 * {@link SignedInAsMarker}; controls read {@link useSignedInAs}. Forms pass
 * it as `disabled` to each field, select and submit button, and wrap their
 * contents in {@link ChangesFieldset}, which turns off anything they missed.
 *
 * A small store outside React, like the toasts' (`useToast`): a provider
 * around every page would have to read the session in the layout, which
 * keeps pages out of their static shell. The server renders the controls as
 * usual (the marker isn't mounted there yet); the browser disables them as
 * soon as the banner arrives, and the server refuses a change either way.
 */
'use client';

import { type ReactNode, useEffect, useSyncExternalStore } from 'react';

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

/**
 * Wraps everything inside a form that changes something (its fields, selects
 * and submit button): while a staff member is signed in as the user, it's a
 * disabled fieldset, which turns them all off at once, as the browser does
 * for every control in a disabled fieldset (they match `:disabled`, so they
 * look disabled too). It adds no box (`display: contents`) and no group
 * (`role="presentation"`), so the form's layout and what screen readers hear
 * stay as they were.
 *
 * It's the safety net: forms still pass `disabled` to each control
 * themselves, so the attribute is on the control (and Radix selects, which
 * read their own `disabled`, stay shut).
 *
 * @param props - Component props.
 * @param props.children - The form's contents.
 * @returns The fieldset.
 */
export function ChangesFieldset({ children }: { children: ReactNode }) {
  const changesOff = useSignedInAs();
  return (
    <fieldset disabled={changesOff} role="presentation" className="contents">
      {children}
    </fieldset>
  );
}
