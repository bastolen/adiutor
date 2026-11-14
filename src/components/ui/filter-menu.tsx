/**
 * @file A filter of a list as a menu: a button that says what's chosen and
 * opens the choices, each of which is a link. The sibling of the Sort menu
 * (`sort-menu.tsx`), for filters with more choices than fit in a row of
 * links (`SegmentedNav`).
 */
'use client';

import { ListFilter } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

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

/** One choice of a {@link FilterMenu}. */
export interface FilterOption {
  /** The choice's value, unique in the menu; `''` for the choice that shows everything. */
  value: string;
  /** Visible text, e.g. "Bug". */
  label: string;
  /** The page with this choice made (build it with `TableLinks.withParams`). */
  href: string;
  /** Whether it's the current choice. */
  current: boolean;
}

/**
 * Props for {@link FilterMenu}.
 */
interface FilterMenuProps {
  /** What's filtered by, e.g. "Type": the button's text while everything shows. */
  label: string;
  /** The menu's heading, e.g. "Filter by type". */
  menuLabel: string;
  /** The choices, the one that shows everything (value `''`) first. */
  options: readonly FilterOption[];
}

/**
 * A button that says what a list is filtered by ("Type", or "Type: Bug" once
 * a choice is made) and opens a menu with every choice, the current one
 * checked. Each choice is a link (a `MenuRadioLinkItem`; the page doesn't
 * scroll), so a filtered list has its own address, and Radix's keyboard
 * behaviour (arrow keys, Escape, focus back on the button) comes with it.
 * The menu closes as soon as a choice is made; until the filtered rows
 * arrive, the button is busy (a spinner and `aria-busy`). It closes when the
 * user navigates away.
 *
 * @param props - Menu props.
 * @param props.label - What's filtered by.
 * @param props.menuLabel - The menu's heading.
 * @param props.options - The choices.
 * @returns The menu's button (the menu itself opens in a portal).
 */
export default function FilterMenu({ label, menuLabel, options }: FilterMenuProps) {
  const t = useTranslations('common.filter');
  const [open, setOpen] = useTransientState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = options.find((option) => option.current);
  return (
    <MenuRoot open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>
        <Button variant="secondary" size="sm" aria-busy={pending || undefined}>
          {pending ? <Spinner /> : <ListFilter aria-hidden="true" />}
          {current && current.value !== ''
            ? t('chosen', { filter: label, choice: current.label })
            : label}
        </Button>
      </MenuTrigger>
      <MenuContent align="start">
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
