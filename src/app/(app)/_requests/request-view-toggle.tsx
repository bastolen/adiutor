/**
 * @file The List | Board toggle of the requests: two links, to the list and
 * the board (`/requests` and `/requests/board` across companies, or a
 * company's on its page), that keep what the requests are narrowed down by.
 * Its text comes from `requests.board`.
 */
import { useTranslations } from 'next-intl';

import SegmentedNav from '@/components/ui/segmented-nav';
import { BOARD_PATH, COMPANY_BOARD_SEGMENT } from '@/lib/requests';
import { createPageUrl } from '@/lib/tables/page-url';

import { type RequestFilters, viewParams } from './request-filters';

/** The two ways to view the requests. */
export type RequestView = 'list' | 'board';

/** Where each view is. */
export type RequestViewPaths = Readonly<Record<RequestView, string>>;

/** Where the views of the requests across companies are. */
export const REQUEST_VIEW_PATHS: RequestViewPaths = { list: '/requests', board: BOARD_PATH };

/**
 * Where the views of one company's requests are, on its page: its list (the
 * company's first page) and its board.
 *
 * @param company - The company's URL name.
 * @returns The paths.
 */
export function companyViewPaths(company: string): RequestViewPaths {
  const list = `/companies/${company}`;
  return { list, board: `${list}/${COMPANY_BOARD_SEGMENT}` };
}

/**
 * Links to the list and the board, shown as one segmented control, the
 * current view marked. Each keeps the search, the filter menus and the sort
 * (the board's lanes keep the list's sort), and the number of rows or cards
 * (`size`); it drops the status link, `?only=` and the page, which mean
 * nothing on the board, whose lanes are the statuses. The links are built
 * from the known parameters only, never by copying the address.
 *
 * @param props - Component props.
 * @param props.view - The view the page shows.
 * @param props.filters - The page's filters.
 * @param props.paths - Where the views are; the requests across companies' unless it's given.
 * @returns The navigation.
 */
export default function RequestViewToggle({
  view,
  filters,
  paths = REQUEST_VIEW_PATHS,
}: {
  view: RequestView;
  filters: RequestFilters;
  paths?: RequestViewPaths;
}) {
  const t = useTranslations('requests.board');
  const tTables = useTranslations('tables');
  const params = viewParams(filters);
  const state = { ...filters.requested, page: 1 };
  /**
   * The address of a view, with the filters kept.
   *
   * @param to - The view.
   * @returns The address.
   */
  const hrefOf = (to: RequestView) => {
    const page = createPageUrl(paths[to], params, tTables);
    page.table(filters.definition, state);
    return page.current();
  };
  return (
    <SegmentedNav
      label={t('viewLabel')}
      items={(['list', 'board'] as const).map((option) => ({
        href: hrefOf(option),
        label: t('view', { view: option }),
        current: option === view,
      }))}
    />
  );
}
