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
 *
 * The marker also tells the page how tall the banner is
 * ({@link BANNER_HEIGHT_VARIABLE}): the banner sticks to the top of every
 * page, and scrolling has to keep what it shows clear of it (`globals.css`).
 */
'use client';

import { type ReactNode, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * The CSS variable on `<html>` that holds the banner's height while it
 * shows, e.g. `76px`. `globals.css` adds it to the page's
 * `scroll-padding-top`, so a control the browser scrolls to (one that gets
 * focus, an anchor) lands below the banner, not under it.
 */
export const BANNER_HEIGHT_VARIABLE = '--signed-in-as-banner-height';

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
 * banner, directly inside it, so it goes away with it ("Back to my account",
 * or an end).
 *
 * Meanwhile it keeps the height of the element it's in, the banner, in
 * {@link BANNER_HEIGHT_VARIABLE} on `<html>`: measured when it mounts and
 * whenever the banner's size changes (its text wraps differently per width
 * and language), and removed when it goes.
 *
 * @returns Nothing visible: a hidden element that tells it where it is.
 */
export function SignedInAsMarker() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    mountedMarkers += 1;
    notify();
    return () => {
      mountedMarkers -= 1;
      notify();
    };
  }, []);

  useEffect(() => {
    const banner = ref.current?.parentElement;
    if (!banner) {
      return undefined;
    }
    const root = document.documentElement;
    /** Notes the banner's height, rounded up to whole pixels so nothing peeks out from under it. */
    const measure = () => {
      root.style.setProperty(
        BANNER_HEIGHT_VARIABLE,
        `${Math.ceil(banner.getBoundingClientRect().height)}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(banner);
    return () => {
      observer.disconnect();
      root.style.removeProperty(BANNER_HEIGHT_VARIABLE);
    };
  }, []);

  return <span ref={ref} hidden />;
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
