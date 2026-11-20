/**
 * @file The page links of a table's pagination (see `Pagination`): Previous,
 * the page numbers and Next.
 */
'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import cn from '@/lib/cn';
import type { PaginationLinks } from '@/lib/tables/table-state';

import Button from './button';
import { isShown } from './focus-fallback';
import LinkPendingIndicator from './link-pending';
import { currentItem, focusRing } from './styles';

/**
 * Props for {@link PaginationNav}.
 */
type PaginationNavProps = Pick<
  PaginationLinks,
  'page' | 'pageCount' | 'previousHref' | 'nextHref' | 'pages'
> & {
  /** The landmark's name, unique on the page, e.g. "Pages of members". */
  label: string;
};

/**
 * Previous and Next (a disabled button on the first or last page), with the
 * page numbers between them from the `sm` breakpoint, and "Page 2 of 6"
 * between just their arrows below it. The links don't scroll the page and
 * show a spinner while the next page loads. After going to another page from
 * here, focus stays in the navigation: when the control used is gone (Next
 * on the last page), the current page's link (or another link here) gets it.
 *
 * @param props - Navigation props.
 * @param props.label - The landmark's name.
 * @param props.page - The page shown.
 * @param props.pageCount - How many pages there are.
 * @param props.previousHref - The previous page, or `null`.
 * @param props.nextHref - The next page, or `null`.
 * @param props.pages - Page numbers and gaps.
 * @returns The navigation.
 */
export default function PaginationNav({
  label,
  page,
  pageCount,
  previousHref,
  nextHref,
  pages,
}: PaginationNavProps) {
  const t = useTranslations('common.pagination');
  const navRef = useRef<HTMLElement>(null);
  /** The page a link here was followed to, until that page is shown. */
  const target = useRef<number | null>(null);

  useEffect(() => {
    const wanted = target.current;
    target.current = null;
    // Only after going to this page from here (not after a sort, or a page link elsewhere).
    if (wanted !== page) {
      return;
    }
    const nav = navRef.current;
    if (!nav || (document.activeElement && document.activeElement !== document.body)) {
      return;
    }
    const links = Array.from(nav.querySelectorAll<HTMLElement>('a[href]')).filter(isShown);
    const current = links.find((link) => link.getAttribute('aria-current') === 'page');
    (current ?? links[0])?.focus();
  }, [page]);

  return (
    <nav ref={navRef} aria-label={label}>
      {/* On phones, Previous and Next show only their arrows (their names stay the same). */}
      <ul className="flex flex-wrap items-center gap-1">
        <li>
          {previousHref ? (
            <Button asChild variant="ghost" size="sm" className="max-sm:px-2">
              <Link
                href={previousHref}
                scroll={false}
                onNavigate={() => {
                  target.current = page - 1;
                }}
              >
                <LinkPendingIndicator>
                  <ChevronLeft aria-hidden="true" />
                </LinkPendingIndicator>
                <span aria-hidden="true" className="max-sm:sr-only">
                  {t('previous')}
                </span>
                <span className="sr-only">{t('previousPage')}</span>
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled className="max-sm:px-2">
              <ChevronLeft aria-hidden="true" />
              <span aria-hidden="true" className="max-sm:sr-only">
                {t('previous')}
              </span>
              <span className="sr-only">{t('previousPage')}</span>
            </Button>
          )}
        </li>
        {pages.map((item) =>
          item.kind === 'gap' ? (
            <li
              key={item.key}
              aria-hidden="true"
              className="hidden px-1 text-sm text-muted-foreground sm:block"
            >
              …
            </li>
          ) : (
            <li key={item.page} className="hidden sm:block">
              <Link
                href={item.href}
                scroll={false}
                onNavigate={() => {
                  target.current = item.page;
                }}
                aria-current={item.current ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium tabular-nums transition-colors',
                  focusRing,
                  currentItem,
                  item.current
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-muted',
                )}
              >
                <span className="sr-only">{t('page', { page: item.page })}</span>
                <LinkPendingIndicator>
                  <span aria-hidden="true">{item.page}</span>
                </LinkPendingIndicator>
              </Link>
            </li>
          ),
        )}
        <li className="min-w-0 px-1 text-sm text-muted-foreground sm:hidden">
          {t('pageOf', { page, pages: pageCount })}
        </li>
        <li>
          {nextHref ? (
            <Button asChild variant="ghost" size="sm" className="max-sm:px-2">
              <Link
                href={nextHref}
                scroll={false}
                onNavigate={() => {
                  target.current = page + 1;
                }}
              >
                <span aria-hidden="true" className="max-sm:sr-only">
                  {t('next')}
                </span>
                <span className="sr-only">{t('nextPage')}</span>
                <LinkPendingIndicator>
                  <ChevronRight aria-hidden="true" />
                </LinkPendingIndicator>
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled className="max-sm:px-2">
              <span aria-hidden="true" className="max-sm:sr-only">
                {t('next')}
              </span>
              <span className="sr-only">{t('nextPage')}</span>
              <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </li>
      </ul>
    </nav>
  );
}
