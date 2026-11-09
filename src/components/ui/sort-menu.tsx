/**
 * @file The Sort menu of a table: the one way to sort it, since column
 * headers aren't links (they only carry `aria-sort`, see
 * `TableLinks.ariaSort`).
 */
'use client';

import { ArrowUpDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

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
 * Props for {@link SortMenu}.
 */
interface SortMenuProps {
  /** What the rows are, in the plural, e.g. "members": it names the button for screen readers. */
  label: string;
  /** The ways to sort, from `TableLinks.sortOptions()`. */
  options: readonly SortOption[];
}

/**
 * A button that says how the table is sorted (just "Sort" on phones; for
 * screen readers always e.g. "Sort members: Name, A to Z") and opens a menu
 * with every way to sort it, the current one checked. Each choice is a link
 * (a `MenuRadioLinkItem`; the page doesn't scroll), and Radix's keyboard
 * behaviour (arrow keys, Escape, focus back on the button) comes with it.
 * The menu closes as soon as a choice is made; until the newly sorted rows
 * arrive, the button is busy (a spinner and `aria-busy`). It closes when the
 * user navigates away.
 *
 * @param props - Menu props.
 * @param props.label - What the rows are.
 * @param props.options - The ways to sort.
 * @returns The menu's button (the menu itself opens in a portal).
 */
export default function SortMenu({ label, options }: SortMenuProps) {
  const t = useTranslations('common.sort');
  const [open, setOpen] = useTransientState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = options.find((option) => option.current);
  return (
    <MenuRoot open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>
        <Button variant="secondary" size="sm" aria-busy={pending || undefined}>
          {pending ? <Spinner /> : <ArrowUpDown aria-hidden="true" />}
          {/* On phones the button says Sort; from 640px (`sm`), how the table is sorted. Both
              are part of its name, which says what's sorted too. */}
          <span aria-hidden="true" className={current ? 'sm:hidden' : undefined}>
            {t('button')}
          </span>
          {current && (
            <span aria-hidden="true" className="max-sm:hidden">
              {current.label}
            </span>
          )}
          <span className="sr-only">
            {current
              ? t('triggerSorted', { rows: label, sort: current.label })
              : t('trigger', { rows: label })}
          </span>
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>{t('sortBy')}</MenuLabel>
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
