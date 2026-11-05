/**
 * @file Shows a toast once when a page arrives with something to confirm,
 * e.g. "User deleted." after the redirect that follows the deletion.
 */
'use client';

import { useEffect, useRef } from 'react';

import Alert from './alert';
import { useToast } from './toast';

/**
 * Toasts the message once (also when a page kept alive is shown again).
 * Without a mounted `Toaster` it's an inline confirmation that takes focus
 * instead.
 *
 * @param props - Component props.
 * @param props.message - What happened, e.g. "User deleted.".
 * @returns Nothing with toasts, otherwise the inline confirmation.
 */
export default function ToastOnArrival({ message }: { message: string }) {
  const showToast = useToast();
  // Refs survive a kept-alive page being hidden and shown, so it's toasted only once.
  const shown = useRef(false);

  useEffect(() => {
    if (!showToast || shown.current) {
      return;
    }
    shown.current = true;
    showToast(message);
  }, [message, showToast]);

  if (showToast) {
    return null;
  }
  return (
    <Alert tone="success" focusOnShow>
      {message}
    </Alert>
  );
}
