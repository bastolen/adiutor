/**
 * @file The List | Board toggle of the requests across companies: two links,
 * to `/requests` and `/requests/board`, that keep what the requests are
 * narrowed down by. Its text comes from `requests.board`.
 */
import { useTranslations } from 'next-intl';

import SegmentedNav from '@/components/ui/segmented-nav';
import { BOARD_PATH } from '@/lib/requests';
import { createPageUrl } from '@/lib/tables/page-url';

import { type RequestFilters, viewParams } from './request-filters';

/** The two ways to view the requests across companies. */
export type RequestView = 'list' | 'board';

/** Where each view is. */
const VIEW_PATHS: Record<RequestView, string> = { list: '/requests', board: BOARD_PATH };

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
 * @returns The navigation.
 */
export default function RequestViewToggle({
  view,
  filters,
}: {
  view: RequestView;
  filters: RequestFilters;
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
    const page = createPageUrl(VIEW_PATHS[to], params, tTables);
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
