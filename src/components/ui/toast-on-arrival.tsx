/**
 * @file Shows a toast once when a page arrives with something to confirm,
 * e.g. "User deleted." after the redirect that follows the deletion, and
 * takes the parameter that asked for it out of the address.
 */
'use client';

import { useEffect, useRef } from 'react';

import Alert from './alert';
import { useToast } from './toast';

/**
 * Takes a query parameter out of the address in the address bar, without
 * loading anything: the page, its other parameters and its `#section` stay
 * as they are, and no history entry is added.
 *
 * The state is `null`, not the entry's own: Next then copies its state to
 * the entry itself and takes the new address into its router, so a later
 * refresh of the page doesn't ask for the parameter again (see "Native
 * History API" in Next's linking and navigating guide).
 *
 * @param name - The parameter, e.g. `raised`.
 */
function dropParameter(name: string): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) {
    return;
  }
  url.searchParams.delete(name);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Toasts the message once (also when a page kept alive is shown again).
 * Without a mounted `Toaster` it's an inline confirmation that takes focus
 * instead.
 *
 * Once it's toasted, the parameter that asked for it leaves the address, so
 * reloading the page, coming back to it or opening a copied link doesn't
 * confirm it a second time.
 *
 * @param props - Component props.
 * @param props.message - What happened, e.g. "User deleted.".
 * @param props.param - The query parameter the page showed this for, e.g. `deleted`.
 * @returns Nothing with toasts, otherwise the inline confirmation.
 */
export default function ToastOnArrival({ message, param }: { message: string; param: string }) {
  const showToast = useToast();
  // Refs survive a kept-alive page being hidden and shown, so it's toasted only once.
  const shown = useRef(false);

  useEffect(() => {
    // Toasts come with the `Toaster`, which can mount a moment after this does.
    if (!showToast || shown.current) {
      return;
    }
    shown.current = true;
    showToast(message);
    dropParameter(param);
  }, [message, param, showToast]);

  if (showToast) {
    return null;
  }
  return (
    <Alert tone="success" focusOnShow>
      {message}
    </Alert>
  );
}
