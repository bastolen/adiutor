/**
 * @file Side sheet: a panel that slides in from the left edge over the page,
 * built on Radix Dialog, e.g. for the navigation on small screens.
 */
'use client';

import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

import Button from './button';

/**
 * Props for {@link Sheet}.
 */
interface SheetProps {
  /** Whether the sheet is open. */
  open: boolean;
  /**
   * Called when it should open or close (the trigger, Escape, the close
   * button, clicking outside).
   */
  onOpenChange: (open: boolean) => void;
  /**
   * The button that opens the sheet, e.g. an icon-only `Button` with an
   * `aria-label`. It gets the dialog's ARIA attributes, and focus returns to
   * it when the sheet closes.
   */
  trigger: ReactElement;
  /**
   * Names the sheet for screen readers. It isn't shown: the content carries
   * its own heading or logo.
   */
  title: string;
  /** Says what's in the sheet, for screen readers only. */
  description: string;
  /** The close button's name for screen readers, e.g. "Close menu". */
  closeLabel: string;
  /** The sheet's content; it fills the panel's height. */
  children: ReactNode;
}

/**
 * A sheet following the WAI-ARIA dialog pattern: focus moves into it, to the
 * link for the current page (`aria-current="page"`) when it has one and else
 * to its first link or button (Radix on its own skips links, which put focus
 * on the account menu at the bottom of the navigation), and stays there, Escape, the close button or clicking outside closes it, and
 * focus returns to the trigger. The close button sits in the top right
 * corner, after the content in the tab order. Close it from the content too
 * where that's expected, e.g. after following a link.
 *
 * @param props - Sheet props.
 * @param props.open - Open state.
 * @param props.onOpenChange - Open state handler.
 * @param props.trigger - The button that opens it.
 * @param props.title - Name for screen readers.
 * @param props.description - Description for screen readers.
 * @param props.closeLabel - The close button's name.
 * @param props.children - Content.
 * @returns The trigger, and the sheet while it's open.
 */
export default function Sheet({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  closeLabel,
  children,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border bg-raised shadow-xl data-[state=open]:animate-slide-in"
          onOpenAutoFocus={(event) => {
            const sheet = event.currentTarget;
            if (!(sheet instanceof HTMLElement)) {
              return;
            }
            const start =
              sheet.querySelector<HTMLElement>('[aria-current="page"]') ??
              sheet.querySelector<HTMLElement>('a[href], button:not([disabled])');
            if (start) {
              event.preventDefault();
              start.focus();
            }
          }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          {children}
          <Dialog.Close asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={closeLabel}
              className="absolute top-4 right-3"
            >
              <X aria-hidden="true" />
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
