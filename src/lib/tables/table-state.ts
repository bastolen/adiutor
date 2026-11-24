/**
 * @file Sorting and pagination state of the app's tables, kept in the URL:
 * the table definitions' types, reading the state from the query string
 * (anything invalid falls back silently to the default) and the page maths.
 * Pure and client-safe; the tables themselves are defined in
 * `src/lib/tables/tables.ts`, and the links that change the state are built
 * by `createPageUrl` in `src/lib/tables/page-url.ts`.
 *
 * Each table has its own query parameters, named by its prefix: `sort`,
 * `dir`, `page` and `size` for a page's main table, `inv-sort` and so on for
 * open invitations. Several tables on one page never collide that way.
 * Defaults are left out of URLs, so a table in its default state adds
 * nothing to the address.
 *
 * Sort names, directions and captions come from the `tables` catalogue, in
 * the reader's language: definitions hold message keys, and the page passes
 * its translator to `createPageUrl`.
 */
import type { Messages } from '@/lib/i18n/messages';
import { type SearchParams, searchParam } from '@/lib/search-params';

/** The page sizes a viewer can choose from. */
export const PAGE_SIZES = [25, 50, 100] as const;

/** A page size a viewer can choose. */
export type PageSize = (typeof PAGE_SIZES)[number];

/** Rows per page until the viewer picks another size. */
export const DEFAULT_PAGE_SIZE: PageSize = 25;

/** Tables with at most this many rows show no pagination at all. */
const PAGINATION_THRESHOLD = 10;

/** Sort direction. */
export type SortDirection = 'asc' | 'desc';

/** The name of a sort, a key of `tables.sorts` (e.g. `name` for "Name"). */
export type SortLabel = keyof Messages['tables']['sorts'];

/** How a direction is said, a key of `tables.directions` (e.g. `aToZ` for "A to Z"). */
export type DirectionLabel = keyof Messages['tables']['directions'];

/**
 * Translates the `tables` namespace: `getTranslations('tables')` on a page,
 * `translator(locale, 'tables')` elsewhere.
 */
export type TablesTranslator = (
  key:
    'option' | 'caption' | 'captionPaged' | `sorts.${SortLabel}` | `directions.${DirectionLabel}`,
  values?: Record<string, string | number>,
) => string;

/** One way a table can be sorted, e.g. by name. */
export interface SortDefinition {
  /**
   * What the sort is called in the Sort menu and the caption, e.g. `name`
   * for "Name" (not always a column's header: the Activity column shows
   * "Last active" and "Joined").
   */
  label: SortLabel;
  /**
   * The direction it's sorted in unless the viewer picks the other one, and
   * the one listed first in the Sort menu: A to Z for text, newest first for
   * dates.
   */
  first: SortDirection;
  /** How each direction is said, e.g. `{ asc: 'aToZ', desc: 'zToA' }`. */
  directions: Readonly<Record<SortDirection, DirectionLabel>>;
}

/** A table's sorting options and where its state lives in the URL. */
export interface TableDefinition<K extends string = string> {
  /** Prefix of its query parameters: `''` for a page's main table, e.g. `inv-` for others. */
  prefix: string;
  /** The sort shown until the viewer picks one (in its first direction). */
  defaultSort: K;
  /** The ways it can be sorted, by key (the key appears in the URL). */
  sorts: Readonly<Record<K, SortDefinition>>;
  /**
   * The anchor of the card the table is in (its `Card` `id`, a section ID,
   * e.g. `invitations`), for the tables that aren't a page's main table:
   * links that change this table end in it, so one opened in a new tab
   * lands on the card. In the app, sort and page links don't scroll anyway.
   */
  section?: string;
}

/** How a table is sorted and which page of it is shown. */
export interface TableState<K extends string = string> {
  /** The sort key. */
  sort: K;
  /** The sort direction. */
  dir: SortDirection;
  /** The page, from 1. */
  page: number;
  /** Rows per page. */
  size: PageSize;
}

/** One page of a list, as list services return it. */
export interface Paged<T> {
  /** The rows on this page. */
  items: T[];
  /** How many rows there are on all pages together. */
  total: number;
  /** The page shown: the one asked for, or the last one when that's past the end. */
  page: number;
  /** Rows per page. */
  size: PageSize;
}

/** A page number in {@link PaginationLinks}, or a gap ("…") between page numbers. */
export type PageLinkItem =
  | {
      /** A page number. */
      kind: 'page';
      /** The page. */
      page: number;
      /** Where it goes. */
      href: string;
      /** Whether it's the page shown. */
      current: boolean;
    }
  | {
      /** Skipped pages. */
      kind: 'gap';
      /** Tells the gap before the current page from the one after it. */
      key: 'gap-start' | 'gap-end';
    };

/** Everything a pagination control shows, with its links built (see `Pagination`). */
export interface PaginationLinks {
  /** What the rows are, in the plural, e.g. "members". */
  label: string;
  /** The page shown. */
  page: number;
  /** How many pages there are. */
  pageCount: number;
  /** How many rows there are. */
  total: number;
  /** The number of the first row on this page, from 1. */
  first: number;
  /** The number of the last row on this page. */
  last: number;
  /** The previous page, or `null` on the first. */
  previousHref: string | null;
  /** The next page, or `null` on the last. */
  nextHref: string | null;
  /** Page numbers and gaps to show (see {@link pageWindow}). */
  pages: PageLinkItem[];
  /** The page sizes to choose from. */
  sizes: {
    /** Rows per page. */
    size: PageSize;
    /** Where it goes (back to the first page). */
    href: string;
    /** Whether it's the size used now. */
    current: boolean;
  }[];
}

/** `aria-sort` of a column header: how the table is sorted by that column. */
export type AriaSort = 'ascending' | 'descending';

/** One choice in a sort menu (see `SortMenu`). */
export interface SortOption {
  /** Identifies the choice, e.g. `name-asc`. */
  value: string;
  /** What it says, e.g. "Name, A to Z". */
  label: string;
  /** Where it goes. */
  href: string;
  /** Whether the table is sorted this way now. */
  current: boolean;
}

/** The ways of saying a text column's directions. */
const TEXT_DIRECTIONS = { asc: 'aToZ', desc: 'zToA' } as const;

/** The ways of saying a date column's directions. */
const DATE_DIRECTIONS = { asc: 'oldestFirst', desc: 'newestFirst' } as const;

/**
 * Defines a sort on text, first A to Z.
 *
 * @param label - What the sort is called, e.g. `name`.
 * @returns The sort.
 */
export function textSort(label: SortLabel): SortDefinition {
  return { label, first: 'asc', directions: TEXT_DIRECTIONS };
}

/**
 * Defines a sort on a date, first newest first.
 *
 * @param label - What the sort is called, e.g. `joined`.
 * @param directions - How the directions are said (by default "newest first" and "oldest first").
 * @returns The sort.
 */
export function dateSort(
  label: SortLabel,
  directions: Readonly<Record<SortDirection, DirectionLabel>> = DATE_DIRECTIONS,
): SortDefinition {
  return { label, first: 'desc', directions };
}

/**
 * Checks whether a value is one of a table's sort keys.
 *
 * @param def - The table.
 * @param value - The value.
 * @returns Whether it's a sort key.
 */
function isSortKey<K extends string>(def: TableDefinition<K>, value: unknown): value is K {
  return typeof value === 'string' && Object.hasOwn(def.sorts, value);
}

/**
 * Checks whether a value is a sort direction.
 *
 * @param value - The value.
 * @returns Whether it's `asc` or `desc`.
 */
function isSortDirection(value: unknown): value is SortDirection {
  return value === 'asc' || value === 'desc';
}

/**
 * Checks whether a value is one of the page sizes.
 *
 * @param value - The value.
 * @returns Whether it's a page size.
 */
function isPageSize(value: unknown): value is PageSize {
  return PAGE_SIZES.includes(value as PageSize);
}

/** Pages a URL may ask for (up to 999,999; anything else is the first page). */
const PAGE_PATTERN = /^[1-9]\d{0,5}$/;

/** The highest page a service is asked for; anything above is past any real list anyway. */
const MAX_PAGE = 999_999;

/**
 * Completes and checks the state a service was given, the same way as
 * {@link parseTableState}: services are called from pages, actions and
 * tests, and never trust it. A sort key, direction, page or page size that
 * isn't valid falls back to its default, each on its own.
 *
 * @param def - The table.
 * @param state - What the caller asked for (any part may be missing).
 * @returns The state.
 */
export function resolveTableState<K extends string>(
  def: TableDefinition<K>,
  state: Partial<TableState<K>> = {},
): TableState<K> {
  const sort = isSortKey(def, state.sort) ? state.sort : def.defaultSort;
  const dir = isSortDirection(state.dir) ? state.dir : def.sorts[sort].first;
  const page =
    typeof state.page === 'number' && Number.isSafeInteger(state.page) && state.page >= 1
      ? Math.min(state.page, MAX_PAGE)
      : 1;
  const size = isPageSize(state.size) ? state.size : DEFAULT_PAGE_SIZE;
  return { sort, dir, page, size };
}

/**
 * Reads a table's state from the query string: each part only as a link
 * writes it, and completed with the defaults by {@link resolveTableState}.
 *
 * @param def - The table.
 * @param params - The page's query string.
 * @returns The state.
 */
export function parseTableState<K extends string>(
  def: TableDefinition<K>,
  params: SearchParams,
): TableState<K> {
  const sort = searchParam(params[`${def.prefix}sort`]);
  const dir = searchParam(params[`${def.prefix}dir`]);
  const page = searchParam(params[`${def.prefix}page`]);
  const size = searchParam(params[`${def.prefix}size`]);
  return resolveTableState(def, {
    sort: isSortKey(def, sort) ? sort : undefined,
    dir: isSortDirection(dir) ? dir : undefined,
    page: page && PAGE_PATTERN.test(page) ? Number(page) : undefined,
    // Only the sizes as links write them: `50`, not `050` or `5e1`.
    size: PAGE_SIZES.find((option) => String(option) === size),
  });
}

/**
 * A table's state as query parameters, leaving out every default: the
 * default sort key, the key's first direction, page 1 and the default size.
 * Always in the same order: sort, direction, page, size.
 *
 * @param def - The table.
 * @param state - Its state.
 * @returns Name and value pairs.
 */
export function tableQuery<K extends string>(
  def: TableDefinition<K>,
  state: TableState<K>,
): [string, string][] {
  const query: [string, string][] = [];
  if (state.sort !== def.defaultSort) {
    query.push([`${def.prefix}sort`, state.sort]);
  }
  if (state.dir !== def.sorts[state.sort].first) {
    query.push([`${def.prefix}dir`, state.dir]);
  }
  if (state.page !== 1) {
    query.push([`${def.prefix}page`, String(state.page)]);
  }
  if (state.size !== DEFAULT_PAGE_SIZE) {
    query.push([`${def.prefix}size`, String(state.size)]);
  }
  return query;
}

/**
 * How many pages a list has (at least one, even when it's empty).
 *
 * @param total - How many rows it has.
 * @param size - Rows per page.
 * @returns The number of pages.
 */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/**
 * The page to show: the one asked for, or the last one when that's past the
 * end (e.g. after the last row of the last page was removed).
 *
 * @param page - The page asked for.
 * @param total - How many rows there are.
 * @param size - Rows per page.
 * @returns The page to show.
 */
export function clampPage(page: number, total: number, size: number): number {
  return Math.min(Math.max(1, page), pageCount(total, size));
}

/**
 * Checks whether a table shows pagination: only with more than
 * {@link PAGINATION_THRESHOLD} rows.
 *
 * @param total - How many rows it has.
 * @returns Whether it shows pagination.
 */
export function showsPagination(total: number): boolean {
  return total > PAGINATION_THRESHOLD;
}

/** Up to this many pages, every page number is shown. */
const ALL_PAGES_UP_TO = 7;

/**
 * Which page numbers a pagination control shows: all of them up to seven
 * pages; otherwise the first, the last and the current one with its
 * neighbours, with a gap for the pages left out (a gap of just one page shows
 * that page instead).
 *
 * @param page - The current page.
 * @param count - How many pages there are.
 * @returns Page numbers and gaps, in order.
 */
export function pageWindow(page: number, count: number): (number | 'gap-start' | 'gap-end')[] {
  if (count <= ALL_PAGES_UP_TO) {
    return Array.from({ length: count }, (_, index) => index + 1);
  }
  const shown = [...new Set([1, page - 1, page, page + 1, count])]
    .filter((value) => value >= 1 && value <= count)
    .sort((a, b) => a - b);
  return shown.flatMap((value, index) => {
    const previous = shown[index - 1];
    if (previous === undefined || value - previous === 1) {
      return [value];
    }
    if (value - previous === 2) {
      return [previous + 1, value];
    }
    return [value <= page ? 'gap-start' : 'gap-end', value];
  });
}
