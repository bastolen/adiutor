/**
 * @file Confirmation dialog for destructive or important actions, built on
 * Radix AlertDialog.
 */
'use client';

import { useTranslations } from 'next-intl';
import { AlertDialog } from 'radix-ui';
import type { ReactNode } from 'react';

import Button from './button';
import { useTransientState } from './use-transient-state';

/**
 * Props for {@link ConfirmDialog}.
 */
interface ConfirmDialogProps {
  /**
   * The element that opens the dialog (usually a `Button`). Without one, the
   * caller opens it with `open` and `onOpenChange`.
   */
  trigger?: ReactNode;
  /**
   * Whether it's open, for a dialog the caller opens itself (e.g. after a
   * choice in a select). Keep it in `useTransientState`, so it's closed when
   * the user comes back to the page.
   */
  open?: boolean;
  /** Called when it opens or closes, with `open`. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Called as it closes, before focus moves. Without a trigger there's nothing
   * to return focus to: call `event.preventDefault()` and focus what opened it.
   */
  onCloseAutoFocus?: (event: Event) => void;
  /** The question, e.g. "Remove Jane from Adiutor?". */
  title: string;
  /** What will happen. */
  description: string;
  /** Text of the confirming button, e.g. "Remove". */
  confirmLabel: string;
  /** Called when the user confirms. */
  onConfirm: () => void;
  /** `danger` styles the confirm button as destructive. Defaults to `danger`. */
  tone?: 'danger' | 'primary';
}

/**
 * A modal dialog that asks for confirmation. Following the WAI-ARIA alert
 * dialog pattern: focus moves into it (to "Cancel", the safe choice), stays
 * inside while it's open, Escape cancels, and focus returns to the trigger
 * when it closes. Without a trigger, the caller controls it with `open` and
 * `onOpenChange`, and returns focus itself (`onCloseAutoFocus`).
 *
 * @param props - Dialog props.
 * @param props.trigger - Element that opens it.
 * @param props.open - Whether it's open, when the caller controls it.
 * @param props.onOpenChange - Called when it opens or closes.
 * @param props.onCloseAutoFocus - Called as it closes, before focus moves.
 * @param props.title - The question.
 * @param props.description - What will happen.
 * @param props.confirmLabel - Confirm button text.
 * @param props.onConfirm - Called on confirm.
 * @param props.tone - Confirm button style.
 * @returns The dialog with its trigger.
 */
export default function ConfirmDialog({
  trigger = undefined,
  open = undefined,
  onOpenChange = undefined,
  onCloseAutoFocus = undefined,
  title,
  description,
  confirmLabel,
  onConfirm,
  tone = 'danger',
}: ConfirmDialogProps) {
  const t = useTranslations('common.actions');
  // Closed again when the user leaves the page (e.g. with the Back button).
  const [ownOpen, setOwnOpen] = useTransientState(false);
  const controlled = open !== undefined;

  return (
    <AlertDialog.Root
      open={controlled ? open : ownOpen}
      onOpenChange={controlled ? onOpenChange : setOwnOpen}
    >
      {trigger && <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <AlertDialog.Content
          onCloseAutoFocus={onCloseAutoFocus}
          className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-border bg-raised p-6 shadow-xl data-[state=open]:animate-pop-in"
        >
          <div className="flex flex-col gap-2">
            <AlertDialog.Title className="text-lg font-semibold text-foreground">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">
              {description}
            </AlertDialog.Description>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">{t('cancel')}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant={tone} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
