/**
 * @file A small panel that opens from a button and shows something to read
 * next to it, such as the names behind a row of avatars. Built on Radix
 * Popover: the button says whether it's open, Escape or a click outside
 * closes it, and focus goes back to the button.
 */
'use client';

import { Popover as RadixPopover } from 'radix-ui';
import type { ReactNode } from 'react';

import cn from '@/lib/cn';

import { focusRing, SCREEN_GUTTER } from './styles';
import { useTransientState } from './use-transient-state';

/**
 * Props for {@link Popover}.
 */
interface PopoverProps {
  /**
   * What the button shows, e.g. a row of avatars. For the eye only: hide it
   * from screen readers (`aria-hidden`), since the button is named by
   * `triggerLabel`.
   */
  trigger: ReactNode;
  /**
   * The button's name, e.g. "Show the 5 subscribers": text only screen
   * readers get, inside the button, so the name is the button's own content
   * (a label over visible text would have to repeat that text).
   */
  triggerLabel: string;
  /** The panel's accessible name, e.g. "Subscribers". */
  label: string;
  /** What the panel shows. */
  children: ReactNode;
}

/**
 * A button that opens a panel below it. The panel is as wide as its content,
 * within the screen, and scrolls when it holds more than fits. It isn't a
 * place for a form: it has nothing to confirm or cancel, and closes on
 * Escape, on a click outside it and on its button. It's closed again when
 * the user comes back to the page (`useTransientState`).
 *
 * @returns The button, and the panel while it's open.
 */
export default function Popover({ trigger, triggerLabel, label, children }: PopoverProps) {
  const [open, setOpen] = useTransientState(false);
  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <RadixPopover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex max-w-full cursor-pointer rounded-lg hover:outline-2 hover:outline-offset-2 hover:outline-border-strong',
            focusRing,
          )}
        >
          <span className="sr-only">{triggerLabel}</span>
          {trigger}
        </button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          aria-label={label}
          align="start"
          sideOffset={8}
          collisionPadding={SCREEN_GUTTER}
          className={cn(
            'z-50 max-h-80 max-w-[min(20rem,calc(100vw-2rem))] min-w-48 overflow-y-auto rounded-lg border border-border bg-raised p-3 shadow-lg',
            focusRing,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
