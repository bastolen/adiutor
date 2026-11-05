/**
 * @file Shows the result of a server action, so every form reports success
 * and failure the same way. In the signed-in app (where a `Toaster` is mounted)
 * a success is a toast and a failure is an inline {@link Alert} that takes
 * keyboard focus, plus a toast. Elsewhere (the signed-out pages) both are
 * inline alerts.
 */
'use client';

import { useEffect, useRef } from 'react';

import type { ActionResult } from '@/lib/action-result';

import Alert from './alert';
import { useToast } from './toast';

/**
 * Props for {@link ResultAlert}.
 */
interface ResultAlertProps {
  /** The result a form's action returned, or `null` before it has run. */
  result: ActionResult<unknown> | null;
  /**
   * Show failures only. For forms that replace themselves with their own
   * confirmation when the action succeeds (that confirmation isn't toasted
   * either). Defaults to `false`.
   */
  errorsOnly?: boolean;
}

/**
 * A result's message: a success as a toast (or an inline confirmation
 * without toasts), a failure as an inline error that moves keyboard focus to
 * itself, so the user lands on what went wrong, and as a toast. Each result
 * is toasted once, also when the page is shown again.
 *
 * @param props - Component props.
 * @param props.result - The action's result, or `null` for nothing.
 * @param props.errorsOnly - Show failures only.
 * @returns The inline alert, or nothing when there's no result or message,
 * or the result is a success that's a toast or `errorsOnly` leaves out.
 */
export default function ResultAlert({ result, errorsOnly = false }: ResultAlertProps) {
  const showToast = useToast();
  // The result last toasted, so a page kept alive doesn't toast it again when shown.
  const toasted = useRef<ActionResult<unknown> | null>(null);

  useEffect(() => {
    if (!showToast || !result?.message || toasted.current === result) {
      return;
    }
    if (result.ok && errorsOnly) {
      return;
    }
    toasted.current = result;
    showToast(result.message, { tone: result.ok ? 'success' : 'error' });
  }, [errorsOnly, result, showToast]);

  if (!result || (result.ok && (errorsOnly || showToast))) {
    return null;
  }

  return (
    <Alert tone={result.ok ? 'success' : 'error'} focusOnShow={!result.ok}>
      {result.message ?? null}
    </Alert>
  );
}
