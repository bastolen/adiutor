/**
 * @file A small button form for one row in a list (e.g. "Revoke"), with an
 * optional confirmation dialog. Its results are toasts in the signed-in app
 * (errors are also shown next to the button), so they're seen and announced
 * even when the action removes the row. On a page that may send the user to
 * confirm it's them, it also sends where to come back to (`ReturnToField`),
 * e.g. for "Resend", whose action asks only once the service refuses, and
 * with `confirmFirst` it sends them there before the action starts.
 */
'use client';

import { type MouseEvent, useCallback, useLayoutEffect, useRef } from 'react';

import { ReturnToField, useRecentConfirmation } from '@/components/auth/recent-confirmation';
import type { ActionResult } from '@/lib/action-result';

import Button, { type ButtonProps } from './button';
import ConfirmDialog from './confirm-dialog';
import restoreFocusIfLost from './focus-fallback';
import { useSignedInAs } from './signed-in-as';
import { useToast } from './toast';
import { useTransientActionState } from './use-transient-state';

/**
 * Props for {@link RowAction}.
 */
interface RowActionProps {
  /** The server action to run. */
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  /** Hidden fields to submit, e.g. IDs. Defaults to none. */
  fields?: Record<string, string>;
  /** Button text. */
  label: string;
  /** Accessible name, when the button text alone is ambiguous in a list. Defaults to the label. */
  ariaLabel?: string;
  /** Button style. Defaults to `secondary`. */
  variant?: ButtonProps['variant'];
  /**
   * Ask for confirmation first: the dialog's question and explanation, and
   * optionally its buttons' texts (the confirming one defaults to the label,
   * the other to "Cancel").
   */
  confirm?: { title: string; description: string; confirmLabel?: string; cancelLabel?: string };
  /**
   * Disables the button, e.g. when there's nothing left to act on. The form
   * stays, so the last result's message stays visible.
   */
  disabled?: boolean;
  /**
   * While `disabled`, stay focusable and ignore presses instead
   * (`Button`'s `focusableWhenDisabled`), for a button that its own action
   * disables, such as "Sign out other devices" once none is left: a disabled
   * button would lose keyboard focus after the refresh. Signed in as a user,
   * it's disabled all the same.
   */
  focusableWhenDisabled?: boolean;
  /**
   * Runs when the button is clicked, before the action or its confirmation
   * dialog starts; call `event.preventDefault()` to stop it (e.g. to send the
   * user to confirm it's them first).
   */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /**
   * Send the user to confirm it's them before the action or its confirmation
   * dialog starts, when they haven't lately (`useRecentConfirmation`), e.g.
   * for "Reactivate" on an account that gets a staff role back. A server
   * page can pass it, unlike `onClick`.
   */
  confirmFirst?: boolean;
  /** ID of the text that explains the button, e.g. why it's disabled. */
  describedBy?: string;
  /**
   * The toast after it worked, naming the row (e.g. "Invitation to
   * jane@adiutor.test revoked."). Defaults to the action's message.
   */
  doneMessage?: string;
  /**
   * Whether the action is the user's own work, which stays allowed while a
   * staff member is signed in as them (see `useSignedInAs`). Every other
   * action renders disabled then, as the server refuses it.
   */
  allowedWhileSignedInAs?: boolean;
}

/**
 * A button that submits hidden fields to a server action and shows a spinner
 * while it runs. With `confirm`, an accessible confirmation dialog opens
 * first. In the signed-in app (where a `Toaster` is mounted), a success is a
 * toast, shown as soon as the action returns, before a refresh can remove the
 * row; an error is shown next to the button and as a toast. If the action
 * removed the button while it had focus, focus moves to its card's heading
 * (`restoreFocusIfLost`). Elsewhere, the result is shown next to the button.
 *
 * @param props - Action props.
 * @param props.action - The server action.
 * @param props.fields - Hidden fields.
 * @param props.label - Button text.
 * @param props.ariaLabel - Accessible name.
 * @param props.variant - Button style.
 * @param props.confirm - Confirmation dialog text.
 * @param props.disabled - Disable the button.
 * @param props.focusableWhenDisabled - Keep it focusable while disabled.
 * @param props.onClick - Runs on click, before the action starts.
 * @param props.confirmFirst - Send the user to confirm it's them first when needed.
 * @param props.describedBy - ID of the text that explains the button.
 * @param props.doneMessage - The toast after it worked; defaults to the action's message.
 * @param props.allowedWhileSignedInAs - Keep it enabled while signed in as the user (their own work).
 * @returns The form.
 */
export default function RowAction({
  action,
  fields = {},
  label,
  ariaLabel = label,
  variant = 'secondary',
  confirm = undefined,
  disabled = false,
  focusableWhenDisabled = false,
  onClick = undefined,
  confirmFirst = false,
  describedBy = undefined,
  doneMessage = undefined,
  allowedWhileSignedInAs = false,
}: RowActionProps) {
  const { askToConfirm } = useRecentConfirmation();
  const showToast = useToast();
  const changesOff = useSignedInAs() && !allowedWhileSignedInAs;
  // Set once the action worked, so the row going away afterwards can move focus.
  const succeeded = useRef(false);

  // Toasts as soon as the action returns: the refresh that comes with it may remove this row.
  const run = useCallback(
    async (previous: ActionResult | null, formData: FormData) => {
      const next = await action(previous, formData);
      if (showToast) {
        const message = next.ok ? (doneMessage ?? next.message) : next.message;
        if (message) {
          showToast(message, { tone: next.ok ? 'success' : 'error' });
        }
        succeeded.current = next.ok;
      }
      return next;
    },
    [action, doneMessage, showToast],
  );
  const [result, formAction, pending, onSubmit] = useTransientActionState(run, null);
  const formRef = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    const form = formRef.current;
    return () => {
      // The action removed this row (or swapped the button): don't leave focus on <body>.
      if (succeeded.current) {
        succeeded.current = false;
        restoreFocusIfLost(form);
      }
    };
  }, []);

  const button = (
    <Button
      type={confirm ? 'button' : 'submit'}
      variant={variant}
      size="sm"
      loading={pending}
      disabled={disabled || changesOff}
      // Signed in as a user, it's off for good: only its own disabling keeps focus.
      focusableWhenDisabled={focusableWhenDisabled && !changesOff}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      onClick={(event) => {
        onClick?.(event);
        // Stopped, the action doesn't start and its confirmation dialog doesn't open.
        if (!event.defaultPrevented && confirmFirst && askToConfirm()) {
          event.preventDefault();
        }
      }}
    >
      {label}
    </Button>
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      className="flex items-center justify-end gap-2"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {/* The page and card to come back to, if the action sends the user to confirm first. */}
      <ReturnToField />
      {/* With toasts, a success is only a toast; an error stays here too. */}
      {result?.message && !(result.ok && showToast) && (
        <span
          role={result.ok ? 'status' : 'alert'}
          className={result.ok ? 'text-xs text-success' : 'text-xs font-medium text-danger'}
        >
          {result.message}
        </span>
      )}
      {confirm ? (
        <ConfirmDialog
          trigger={button}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel ?? label}
          cancelLabel={confirm.cancelLabel}
          tone={variant === 'danger' || variant === 'danger-subtle' ? 'danger' : 'primary'}
          onConfirm={() => formRef.current?.requestSubmit()}
        />
      ) : (
        button
      )}
    </form>
  );
}
