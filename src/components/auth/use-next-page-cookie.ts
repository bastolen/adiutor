/**
 * @file Reads and removes the short-lived cookies the server sets to tell the
 * next page something (`setNextPageCookie` in
 * `src/server/auth/auth-events/`), such as `ProviderLinkedNotice` and
 * `ProviderStepUpNotice`. They're only read in the browser, so no page turns
 * dynamic for them, and removing one updates every component that shows it.
 */
'use client';

import { useSyncExternalStore } from 'react';

import { cookieValue } from '@/lib/request/cookie-value';

/** Event fired in this tab when one of these cookies is removed. */
const CHANGE_EVENT = 'adiutor-next-page-cookie-change';

/**
 * Reads a cookie's value.
 *
 * @param name - The cookie's name.
 * @returns The decoded value, or `null` without a usable cookie.
 */
function readCookie(name: string): string | null {
  return cookieValue(document.cookie, name);
}

/**
 * Subscribes to these cookies being removed.
 *
 * @param onChange - Called when one was.
 * @returns A function that unsubscribes.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/**
 * Nothing during server rendering: the cookie is only read in the browser.
 *
 * @returns `null`.
 */
const getServerSnapshot = (): string | null => null;

/**
 * Reads a next-page cookie, and follows it being removed in this tab.
 *
 * @param name - The cookie's name.
 * @returns Its decoded value (a string, so React can tell when it changed;
 *   parse it while rendering), or `null` without one and on the server.
 */
export function useNextPageCookie(name: string): string | null {
  return useSyncExternalStore(subscribe, () => readCookie(name), getServerSnapshot);
}

/**
 * Removes a next-page cookie, which hides whatever shows it.
 *
 * @param name - The cookie's name.
 */
export function clearNextPageCookie(name: string): void {
  document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
