/**
 * @file Modal dialog for short tasks (forms, setup steps), and, large, for
 * something to write with room, built on Radix Dialog. Its content knows
 * it's inside a dialog (`InsideDialog`), so an error it shows inline raises
 * no toast above the dialog.
 */
'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog } from 'radix-ui';
import { type ReactNode, useRef } from 'react';

import cn from '@/lib/cn';

import Button from './button';
import { InsideDialog } from './inside-dialog';

/**
 * Classes per size of the dialog's panel. `md` is as wide as a short form
 * and as tall as its content, which scrolls when the window is lower. `large`
 * is for something to write with room: as tall as the window allows and up
 * to 60rem wide, with its content filling the height (the content scrolls
 * what's too tall itself); on a narrow screen it's the whole screen, without
 * a border or round corners.
 */
const sizeClasses = {
  md: 'max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md gap-5 overflow-y-auto rounded-xl border p-6',
  large:
    'h-dvh w-full gap-4 p-4 sm:h-[calc(100dvh-4rem)] sm:w-[calc(100%-4rem)] sm:max-w-[60rem] sm:rounded-xl sm:border sm:p-6',
} as const;

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
  /** The panel's size. Defaults to `md`; `large` fills most of the window. */
  size?: keyof typeof sizeClasses;
  /**
   * Takes the focus when the dialog opens, instead of the dialog's first
   * control: for a dialog that's opened to go on with something, such as a
   * text that's being written.
   */
  initialFocus?: () => void;
  /**
   * Takes the focus when the dialog closes, instead of what opened it: for
   * when that isn't where it was any more, or for what the dialog asked for
   * to happen at that moment (so nothing takes the focus afterwards). It
   * returns `false` when it has nothing to focus after all: what opened the
   * dialog gets the focus back, as without it.
   */
  finalFocus?: () => boolean | void;
  /** The dialog's content. */
  children: ReactNode;
}

/**
 * A dialog following the WAI-ARIA dialog pattern: focus moves into it and
 * stays there, Escape or the close button closes it, and focus returns to
 * what opened it (also when it's opened from code rather than a trigger).
 * An error shown in it (`ResultAlert`, `Alert`'s `alsoToast`) stays inline,
 * without a toast (see `InsideDialog`), so one Escape always closes the dialog.
 * Use `ConfirmDialog` for yes/no questions instead.
 *
 * A caller can say what gets the focus instead, when it opens
 * (`initialFocus`) and when it closes (`finalFocus`); focus never stays
 * behind on the page, or on nothing.
 */
export default function Modal({
  open,
  onOpenChange,
  title,
  description = undefined,
  size = 'md',
  initialFocus = undefined,
  finalFocus = undefined,
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
          onOpenAutoFocus={(event) => {
            opener.current = document.activeElement as HTMLElement | null;
            if (initialFocus) {
              event.preventDefault();
              initialFocus();
            }
          }}
          onCloseAutoFocus={(event) => {
            if (finalFocus && finalFocus() !== false) {
              event.preventDefault();
            } else if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col border-border bg-raised shadow-xl data-[state=open]:animate-pop-in',
            sizeClasses[size],
          )}
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
