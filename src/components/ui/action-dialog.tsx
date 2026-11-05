/**
 * @file A button that opens a dialog with a short form for an important
 * action that needs extra input, e.g. typing an email address to confirm a
 * deletion or a password to deactivate an account. In the signed-in app its
 * success is a toast, so it's seen even when the action removes the button.
 */
'use client';

import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { ReturnToField, useRecentConfirmation } from '@/components/auth/recent-confirmation';
import type { ActionResult } from '@/lib/action-result';

import Button, { type ButtonProps } from './button';
import restoreFocusIfLost from './focus-fallback';
import Modal from './modal';
import ResultAlert from './result-alert';
import { useToast } from './toast';
import { useTransientActionState, useTransientState } from './use-transient-state';

/**
 * Props for {@link ActionDialog}.
 */
interface ActionDialogProps {
  /** The server action to run with the form. */
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  /** Hidden fields to submit, e.g. IDs. */
  fields?: Record<string, string>;
  /** Text of the button that opens the dialog. */
  triggerLabel: string;
  /** Style of the button that opens the dialog. Defaults to `secondary`. */
  triggerVariant?: ButtonProps['variant'];
  /** The dialog's title, e.g. "Delete Jane's account?". */
  title: string;
  /** What will happen. */
  description: ReactNode;
  /** Text of the submit button, e.g. "Delete account". */
  confirmLabel: string;
  /** `danger` styles the submit button as destructive. Defaults to `danger`. */
  tone?: 'danger' | 'primary';
  /** The form's fields (labelled inputs). */
  children?: ReactNode;
  /** Disables the opening button, e.g. when there's nothing to act on. */
  disabled?: boolean;
  /**
   * Runs when the opening button is clicked, before the dialog opens; call
   * `event.preventDefault()` to keep it closed (e.g. to send the user to
   * confirm it's them first).
   */
  onTriggerClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /**
   * Send the user to confirm it's them before the dialog opens, when they
   * haven't lately (`useRecentConfirmation`), e.g. for "Make staff", whose
   * every role needs a recent confirmation. A server page can pass it,
   * unlike `onTriggerClick`.
   */
  confirmFirst?: boolean;
}

/**
 * The form inside an {@link ActionDialog}.
 *
 * @param props - Form props.
 * @param props.action - The server action.
 * @param props.fields - Hidden fields.
 * @param props.confirmLabel - Submit button text.
 * @param props.tone - Submit button style.
 * @param props.onDone - Called with the message after a successful result.
 * @param props.onCancel - Called when Cancel is pressed.
 * @param props.children - Form fields.
 * @returns The form.
 */
function ActionDialogForm({
  action,
  fields,
  confirmLabel,
  tone,
  onDone,
  onCancel,
  children,
}: Pick<ActionDialogProps, 'action' | 'confirmLabel' | 'children'> & {
  fields: Record<string, string>;
  tone: 'danger' | 'primary';
  onDone: (message?: string) => void;
  onCancel: () => void;
}) {
  // Through the shared hook's `onSubmit`, so a refused submit (a wrong password) keeps the input.
  const [result, formAction, pending, onSubmit] = useTransientActionState(action, null);

  useEffect(() => {
    if (result?.ok) {
      onDone(result.message);
    }
  }, [result, onDone]);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {/* The page and card to come back to, if the action sends the user to confirm first. */}
      <ReturnToField />
      <ResultAlert result={result} errorsOnly />
      {children}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant={tone} loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Opens a {@link Modal} with a form posting to a server action. A failed
 * result is shown in the dialog, which stays open (and as a toast in the
 * signed-in app); a successful one closes it, and its message is a toast in
 * the signed-in app (shown as soon as the action returns) or else shown next
 * to the button. Escape or Cancel closes it without submitting, and focus
 * returns to the button; if the action removed the button (e.g. "Make staff"
 * becoming "Remove staff access"), focus moves to its card's heading.
 *
 * @param props - Dialog props.
 * @param props.action - The server action.
 * @param props.fields - Hidden fields.
 * @param props.triggerLabel - Opening button text.
 * @param props.triggerVariant - Opening button style.
 * @param props.title - Title.
 * @param props.description - What will happen.
 * @param props.confirmLabel - Submit button text.
 * @param props.tone - Submit button style.
 * @param props.children - Form fields.
 * @param props.disabled - Disable the opening button.
 * @param props.onTriggerClick - Runs before the dialog opens; can keep it closed.
 * @param props.confirmFirst - Send the user to confirm it's them first when needed.
 * @returns The button and dialog.
 */
export default function ActionDialog({
  action,
  fields = {},
  triggerLabel,
  triggerVariant = 'secondary',
  title,
  description,
  confirmLabel,
  tone = 'danger',
  children = undefined,
  disabled = false,
  onTriggerClick = undefined,
  confirmFirst = false,
}: ActionDialogProps) {
  const { askToConfirm } = useRecentConfirmation();
  const [open, setOpen] = useTransientState(false);
  const [message, setMessage] = useTransientState<string | null>(null);
  // A fresh form state per opening, so an old error doesn't show again.
  const [attempt, setAttempt] = useState(0);
  const showToast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  // Set once the action worked, so this button going away afterwards can move focus.
  const succeeded = useRef(false);

  // Toasts a success as soon as the action returns: the refresh may remove this button.
  // Errors toast where they're shown, in the dialog's `ResultAlert`.
  const run = useCallback(
    async (previous: ActionResult | null, formData: FormData) => {
      const next = await action(previous, formData);
      if (showToast && next.ok) {
        if (next.message) {
          showToast(next.message);
        }
        succeeded.current = true;
      }
      return next;
    },
    [action, showToast],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    return () => {
      if (succeeded.current) {
        succeeded.current = false;
        restoreFocusIfLost(container);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="flex items-center justify-end gap-2">
      {message && (
        <span role="status" className="text-xs text-success">
          {message}
        </span>
      )}
      <Button
        variant={triggerVariant}
        size="sm"
        disabled={disabled}
        onClick={(event) => {
          onTriggerClick?.(event);
          if (event.defaultPrevented) {
            return;
          }
          if (confirmFirst && askToConfirm()) {
            return;
          }
          setMessage(null);
          setOpen(true);
        }}
      >
        {triggerLabel}
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setAttempt((value) => value + 1);
          }
        }}
        title={title}
        description={description}
      >
        <ActionDialogForm
          key={attempt}
          action={run}
          fields={fields}
          confirmLabel={confirmLabel}
          tone={tone}
          onDone={(done) => {
            // With toasts, the toast already said it.
            setMessage(showToast ? null : (done ?? null));
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        >
          {children}
        </ActionDialogForm>
      </Modal>
    </div>
  );
}
