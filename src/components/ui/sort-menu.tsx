/**
 * @file The Sort menu of a table: the one way to sort it, since column
 * headers aren't links (they only carry `aria-sort`, see
 * `TableLinks.ariaSort`).
 */
'use client';

import { ArrowUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { SortOption } from '@/lib/tables/table-state';

import LinkRadioMenu from './link-radio-menu';

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
 * A button that says how the table is sorted (just "Sort" on phones), named
 * in full at every width (`aria-label`, e.g. "Sort members: Name, A to Z",
 * which names its menu too), and opens a menu
 * with every way to sort it, the current one checked. Each choice is a link
 * (a `MenuRadioLinkItem`; the page doesn't scroll), and Radix's keyboard
 * behaviour (arrow keys, Escape, focus back on the button) comes with it.
 * The menu closes as soon as a choice is made; until the newly sorted rows
 * arrive, the button is busy (a spinner and `aria-busy`). It closes when the
 * user navigates away. The shared part is {@link LinkRadioMenu}.
 *
 * @returns The menu's button (the menu itself opens in a portal).
 */
export default function SortMenu({ label, options }: SortMenuProps) {
  const t = useTranslations('common.sort');
  return (
    <LinkRadioMenu
      icon={ArrowUpDown}
      align="end"
      menuLabel={t('sortBy')}
      options={options}
      // Its name holds what it shows at every width ("Sort", or how it's sorted), and names the
      // menu too.
      triggerLabel={(current) =>
        current
          ? t('triggerSorted', { rows: label, sort: current.label })
          : t('trigger', { rows: label })
      }
      renderTrigger={(current) => (
        <>
          {/* On phones the button says Sort; from 640px (`sm`), how the table is sorted. */}
          <span className={current ? 'sm:hidden' : undefined}>{t('button')}</span>
          {current && <span className="max-sm:hidden">{current.label}</span>}
        </>
      )}
    />
  );
}
