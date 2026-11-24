/**
 * @file The menu that `SortMenu` and `FilterMenu` share: a button that opens
 * a radio menu whose every choice is a link, navigating in a transition so
 * the button shows it is busy until the new rows arrive.
 */
'use client';

import type { LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { ReactNode } from 'react';

import type { SortOption } from '@/lib/tables/table-state';

import Button from './button';
import {
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioLinkItem,
  MenuRoot,
  MenuTrigger,
} from './dropdown-menu';
import Spinner from './spinner';
import { useTransientState } from './use-transient-state';

/**
 * Props for {@link LinkRadioMenu}.
 */
interface LinkRadioMenuProps {
  /** The icon in the button; a spinner takes its place while a choice loads. */
  icon: LucideIcon;
  /** Which side of the button the menu lines up with. */
  align: 'start' | 'end';
  /** The menu's heading. */
  menuLabel: string;
  /** The choices; the one with `current` set is checked. */
  options: readonly SortOption[];
  /**
   * What the button says after its icon.
   *
   * @param current - The current choice, if any.
   * @returns The button's content.
   */
  renderTrigger: (current: SortOption | undefined) => ReactNode;
  /**
   * The button's name, for a button that shows less than it says (it shows
   * "Name, A to Z" and is named "Sort members: Name, A to Z"). It's the
   * button's `aria-label`, so it must hold the words the button shows (WCAG
   * 2.5.3), and it names the menu too. Left out, what the button shows names
   * it. Never put a copy only screen readers get in the button's content
   * instead: the open menu would read it along with what the button shows.
   *
   * @param current - The current choice, if any.
   * @returns The button's name.
   */
  triggerLabel?: (current: SortOption | undefined) => string;
}

/**
 * A secondary small button that opens a menu with one link per choice, the
 * current one checked (Radix brings the keyboard behaviour). The menu closes
 * as soon as a choice is made, and until the new page arrives the button is
 * busy (a spinner and `aria-busy`). The menu is named by its button (Radix's
 * `aria-labelledby`): by `triggerLabel` when there is one, else by what the
 * button shows. The menu's open state is transient, so it isn't still open
 * when the user comes back to the page.
 *
 * @returns The menu's button (the menu itself opens in a portal).
 */
export default function LinkRadioMenu({
  icon: Icon,
  align,
  menuLabel,
  options,
  renderTrigger,
  triggerLabel = undefined,
}: LinkRadioMenuProps) {
  const [open, setOpen] = useTransientState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = options.find((option) => option.current);
  return (
    <MenuRoot open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label={triggerLabel?.(current)}
          aria-busy={pending || undefined}
        >
          {pending ? <Spinner /> : <Icon aria-hidden="true" />}
          {renderTrigger(current)}
        </Button>
      </MenuTrigger>
      <MenuContent align={align}>
        <MenuLabel>{menuLabel}</MenuLabel>
        <MenuRadioGroup value={current?.value}>
          {options.map((option) => (
            <MenuRadioLinkItem
              key={option.value}
              value={option.value}
              href={option.href}
              scroll={false}
              // Navigates in a transition of its own, so the button shows it's busy.
              onNavigate={(event) => {
                event.preventDefault();
                startTransition(() => router.push(option.href, { scroll: false }));
              }}
            >
              {option.label}
            </MenuRadioLinkItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}
