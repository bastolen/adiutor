/**
 * @file A filter of a list as a menu: a button that says what's chosen and
 * opens the choices, each of which is a link. The sibling of the Sort menu
 * (`sort-menu.tsx`), for filters with more choices than fit in a row of
 * links (`SegmentedNav`).
 */
'use client';

import { ListFilter } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { SortOption } from '@/lib/tables/table-state';

import LinkRadioMenu from './link-radio-menu';

/**
 * One choice of a {@link FilterMenu}: the same shape as a sort choice
 * (`value` is `''` for the choice that shows everything; `href` is built with
 * `TableLinks.withParams`).
 */
export type FilterOption = SortOption;

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
 * checked. Each choice is a link, so a filtered list has its own address. How
 * the menu behaves (keyboard, busy while the filtered rows arrive) is
 * {@link LinkRadioMenu}'s.
 *
 * @returns The menu's button (the menu itself opens in a portal).
 */
export default function FilterMenu({ label, menuLabel, options }: FilterMenuProps) {
  const t = useTranslations('common.filter');
  return (
    <LinkRadioMenu
      icon={ListFilter}
      align="start"
      menuLabel={menuLabel}
      options={options}
      renderTrigger={(current) =>
        current && current.value !== ''
          ? t('chosen', { filter: label, choice: current.label })
          : label
      }
    />
  );
}
