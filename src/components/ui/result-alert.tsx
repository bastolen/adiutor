/**
 * @file Shows the result of a server action, so every form reports success
 * and failure the same way. In the signed-in app (where a `Toaster` is mounted)
 * a success is a toast and a failure is an inline {@link Alert} that takes
 * keyboard focus, plus a toast (inside a dialog the failure stays inline
 * only, see `InsideDialog`). Elsewhere (the signed-out pages) both are inline
 * alerts. Every new result gets an alert of its own, so the same error a
 * second time is announced and takes focus again.
 */
'use client';

import { useEffect, useRef, useState } from 'react';

import type { ActionResult } from '@/lib/action-result';

import Alert from './alert';
import { useInsideDialog } from './inside-dialog';
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
 * is toasted once, also when the page is shown again; a failure inside a
 * dialog isn't toasted at all, so one Escape closes the dialog.
 *
 * The alert is keyed on the result: `useActionState` keeps the previous
 * result on screen until the next one arrives, so a second failure with the
 * same message would change nothing in the page. A new result object puts a
 * new alert in its place, which screen readers announce and which takes
 * focus, however alike the two messages are.
 *
 * @returns The inline alert, or nothing when there's no result or message,
 * or the result is a success that's a toast or `errorsOnly` leaves out.
 */
export default function ResultAlert({ result, errorsOnly = false }: ResultAlertProps) {
  const showToast = useToast();
  // In a dialog a failure stays inline: a toast above it would take the first Escape.
  const insideDialog = useInsideDialog();
  // The result last toasted, so a page kept alive doesn't toast it again when shown.
  const toasted = useRef<ActionResult<unknown> | null>(null);
  // Counts the results as they arrive (derived while rendering): the alert's key.
  const [shown, setShown] = useState({ result, count: 0 });
  if (shown.result !== result) {
    setShown({ result, count: shown.count + 1 });
  }

  useEffect(() => {
    if (!showToast || !result?.message || toasted.current === result) {
      return;
    }
    if (result.ok ? errorsOnly : insideDialog) {
      return;
    }
    toasted.current = result;
    showToast(result.message, { tone: result.ok ? 'success' : 'error' });
  }, [errorsOnly, insideDialog, result, showToast]);

  if (!result || (result.ok && (errorsOnly || showToast))) {
    return null;
  }

  return (
    <Alert key={shown.count} tone={result.ok ? 'success' : 'error'} focusOnShow={!result.ok}>
      {result.message ?? null}
    </Alert>
  );
}
