/**
 * @file A table's pagination, for its card's footer: which rows are shown,
 * links to the other pages and a choice of rows per page (see
 * `src/lib/tables/table-state.ts`, which builds the links), and the footer
 * itself (`paginationFooter`), which is only there when the rows don't fit
 * on one page. The choice of sizes is also a component of its own
 * (`PageSizeLinks`), for a view that shows a number of rows without pages,
 * like the board's cards per lane.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import cn from '@/lib/cn';
import {
  type PageSize,
  type Paged,
  type PaginationLinks,
  showsPagination,
} from '@/lib/tables/table-state';

import LinkPendingIndicator from './link-pending';
import PaginationNav from './pagination-nav';
import { currentItem, focusRing } from './styles';

/**
 * Props for {@link PageSizeLinks}.
 */
interface PageSizeLinksProps {
  /** What the choice is, shown before the sizes, e.g. "Per page". */
  label: string;
  /** The group's name for screen readers, unique on the page, e.g. "Per page, members". */
  groupLabel: string;
  /**
   * Names one size for screen readers, e.g. "50 per page".
   *
   * @param size - The size.
   * @returns Its name.
   */
  optionLabel: (size: PageSize) => string;
  /** The sizes, each with its link and whether it's the one used now. */
  sizes: PaginationLinks['sizes'];
}

/**
 * A choice of sizes as a row of links (25, 50, 100), the current one filled
 * like the current page (and outlined in forced-colours mode,
 * `currentItem`), named as a group. The links don't scroll the page and show
 * a spinner while the new size loads. It's part of {@link Pagination}, and a
 * view with a number of rows but no pages (the board's cards per lane) uses
 * it alone.
 */
export function PageSizeLinks({ label, groupLabel, optionLabel, sizes }: PageSizeLinksProps) {
  return (
    <div role="group" aria-label={groupLabel} className="flex items-center gap-2">
      <span aria-hidden="true" className="text-sm text-muted-foreground">
        {label}
      </span>
      <ul className="inline-flex gap-0.5 rounded-lg border border-border bg-muted p-0.5">
        {sizes.map((option) => (
          <li key={option.size}>
            <Link
              href={option.href}
              scroll={false}
              aria-current={option.current ? 'true' : undefined}
              className={cn(
                'inline-flex h-7 min-w-9 items-center justify-center rounded-md px-2 text-sm font-medium tabular-nums transition-colors',
                focusRing,
                currentItem,
                // The same look as the current page, so it stands out clearly (`currentItem` outlines both in forced colours).
                option.current
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-surface hover:text-foreground',
              )}
            >
              <LinkPendingIndicator>
                <span aria-hidden="true">{option.size}</span>
              </LinkPendingIndicator>
              <span className="sr-only">{optionLabel(option.size)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Showing 26–50 of 132", the page links (with more than one page) and the
 * page sizes. It's meant for tables with more than 10 rows (see
 * `showsPagination`). The row count is a status message, so screen readers
 * hear it change after going to another page; the landmark and group names
 * include `label`, so several tables on one page can be told apart.
 */
export default function Pagination({
  label,
  page,
  pageCount,
  total,
  first,
  last,
  previousHref,
  nextHref,
  pages,
  sizes,
}: PaginationLinks) {
  const t = useTranslations('common.pagination');
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <p role="status" className="text-sm text-muted-foreground tabular-nums">
        {t('showing', { first, last, total })}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {pageCount > 1 && (
          <PaginationNav
            label={t('pages', { rows: label })}
            page={page}
            pageCount={pageCount}
            previousHref={previousHref}
            nextHref={nextHref}
            pages={pages}
          />
        )}
        <PageSizeLinks
          label={t('perPage')}
          groupLabel={t('perPageGroup', { rows: label })}
          optionLabel={(size) => t('perPageOption', { size })}
          sizes={sizes}
        />
      </div>
    </div>
  );
}

/**
 * The footer of a table's card: the pagination when the rows don't fit on
 * one page, and nothing otherwise (`showsPagination`). It's a function, not
 * a component, because `Card` shows a footer for anything it's given: a
 * component that renders nothing would still leave an empty footer.
 *
 * @param table - The table's links, from `PageUrl.table()`.
 * @param table.pagination - Builds the pagination's content.
 * @param paged - The rows shown, with how many there are in all.
 * @param label - What the rows are, in the plural.
 * @returns The pagination, or `false` when every row fits on one page.
 */
export function paginationFooter(
  table: { pagination(paged: Paged<unknown>, label: string): PaginationLinks },
  paged: Paged<unknown>,
  label: string,
): ReactNode {
  return showsPagination(paged.total) && <Pagination {...table.pagination(paged, label)} />;
}
