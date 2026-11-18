/**
 * @file Modal dialog for short tasks (forms, setup steps), built on Radix
 * Dialog. Its content knows it's inside a dialog (`InsideDialog`), so an
 * error it shows inline raises no toast above the dialog.
 */
'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog } from 'radix-ui';
import { type ReactNode, useRef } from 'react';

import Button from './button';
import { InsideDialog } from './inside-dialog';

/**
 * Props for {@link Modal}.
 */
interface ModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when it should open or close (Escape, the close button, clicking outside). */
  onOpenChange: (open: boolean) => void;
  /** The dialog's title. */
  title: string;
  /** Short explanation below the title. */
  description?: ReactNode;
  /** The dialog's content. */
  children: ReactNode;
}

/**
 * A dialog following the WAI-ARIA dialog pattern: focus moves into it and
 * stays there, Escape or the close button closes it, and focus returns to
 * what opened it (also when it's opened from code rather than a trigger).
 * An error shown in it (`ResultAlert`, `Alert`'s `alsoToast`) stays inline,
 * without a toast: a toast would be a layer above the dialog and take the
 * first Escape, so one Escape always closes the dialog.
 * Use `ConfirmDialog` for yes/no questions instead.
 *
 * @param props - Dialog props.
 * @param props.open - Open state.
 * @param props.onOpenChange - Open state handler.
 * @param props.title - Title.
 * @param props.description - Explanation.
 * @param props.children - Content.
 * @returns The dialog.
 */
export default function Modal({
  open,
  onOpenChange,
  title,
  description = undefined,
  children,
}: ModalProps) {
  const t = useTranslations('common.actions');
  /** What had focus when the dialog opened, to return focus to on close. */
  const opener = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <Dialog.Content
          onOpenAutoFocus={() => {
            opener.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-xl border border-border bg-raised p-6 shadow-xl data-[state=open]:animate-pop-in"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <Dialog.Title className="text-lg font-semibold text-foreground">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-sm text-muted-foreground">
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label={t('close')} className="-mt-1 -mr-2">
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <InsideDialog>{children}</InsideDialog>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
