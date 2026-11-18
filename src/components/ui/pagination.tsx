/**
 * @file A table's pagination, for its card's footer: which rows are shown,
 * links to the other pages and a choice of rows per page (see
 * `src/lib/tables/table-state.ts`, which builds the links), and the footer
 * itself (`paginationFooter`), which is only there when the rows don't fit
 * on one page.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import cn from '@/lib/cn';
import { type Paged, type PaginationLinks, showsPagination } from '@/lib/tables/table-state';

import LinkPendingIndicator from './link-pending';
import PaginationNav from './pagination-nav';
import { focusRing } from './styles';

/**
 * "Showing 26–50 of 132", the page links (with more than one page) and the
 * page sizes. It's meant for tables with more than 10 rows (see
 * `showsPagination`). The row count is a status message, so screen readers
 * hear it change after going to another page; the landmark and group names
 * include `label`, so several tables on one page can be told apart.
 *
 * @param props - The pagination's content, from `TableLinks.pagination()`.
 * @param props.label - What the rows are, in the plural.
 * @param props.page - The page shown.
 * @param props.pageCount - How many pages there are.
 * @param props.total - How many rows there are.
 * @param props.first - The first row shown.
 * @param props.last - The last row shown.
 * @param props.previousHref - The previous page.
 * @param props.nextHref - The next page.
 * @param props.pages - Page numbers and gaps.
 * @param props.sizes - The page sizes.
 * @returns The pagination.
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
        <div
          role="group"
          aria-label={t('perPageGroup', { rows: label })}
          className="flex items-center gap-2"
        >
          <span aria-hidden="true" className="text-sm text-muted-foreground">
            {t('perPage')}
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
                    // The same look as the current page, so it stands out clearly.
                    option.current
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-surface hover:text-foreground',
                  )}
                >
                  <LinkPendingIndicator>
                    <span aria-hidden="true">{option.size}</span>
                  </LinkPendingIndicator>
                  <span className="sr-only">{t('perPageOption', { size: option.size })}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
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
