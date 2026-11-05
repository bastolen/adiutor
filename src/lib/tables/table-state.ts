/**
 * @file Sorting and pagination state of the app's tables, kept in the URL:
 * reading it from the query string (anything invalid falls back silently to
 * the default) and building the links that change it. Pure and client-safe;
 * the tables themselves are defined in `src/lib/tables/tables.ts`.
 *
 * Each table has its own query parameters, named by its prefix: `sort`,
 * `dir`, `page` and `size` for a page's main table, `inv-sort` and so on for
 * open invitations. Several tables on one page never collide that way.
 * Defaults are left out of URLs, so a table in its default state adds
 * nothing to the address. Links are built only from known parameters (the
 * page's own, such as `q`, and every table's state), so one-off ones such as
 * `?connected=github` don't come back after a sort. Links that change a table
 * with a `section` end in that card's anchor (`#invitations`), and
 * `PageUrl.current()` is the page as it is, for return addresses.
 */
import { withSection } from '@/lib/redirect';

import { type SearchParams, searchParam } from './search-params';

/** The page sizes a viewer can choose from. */
export const PAGE_SIZES = [25, 50, 100] as const;

/** A page size a viewer can choose. */
export type PageSize = (typeof PAGE_SIZES)[number];

/** Rows per page until the viewer picks another size. */
export const DEFAULT_PAGE_SIZE: PageSize = 25;

/** Tables with at most this many rows show no pagination at all. */
export const PAGINATION_THRESHOLD = 10;

/** Sort direction. */
export type SortDirection = 'asc' | 'desc';

/** One way a table can be sorted, e.g. by name. */
export interface SortDefinition {
  /**
   * What the sort is called in the Sort menu and the caption, e.g. "Name"
   * (not always a column's header: the Activity column shows "Last active"
   * and "Joined").
   */
  label: string;
  /**
   * The direction it's sorted in unless the viewer picks the other one, and
   * the one listed first in the Sort menu: A to Z for text, newest first for
   * dates.
   */
  first: SortDirection;
  /** How each direction is said, e.g. `{ asc: 'A to Z', desc: 'Z to A' }`. */
  directions: Readonly<Record<SortDirection, string>>;
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
const TEXT_DIRECTIONS = { asc: 'A to Z', desc: 'Z to A' } as const;

/** The ways of saying a date column's directions. */
const DATE_DIRECTIONS = { asc: 'oldest first', desc: 'newest first' } as const;

/**
 * Defines a sort on text, first A to Z.
 *
 * @param label - What the sort is called, e.g. "Name".
 * @returns The sort.
 */
export function textSort(label: string): SortDefinition {
  return { label, first: 'asc', directions: TEXT_DIRECTIONS };
}

/**
 * Defines a sort on a date, first newest first.
 *
 * @param label - What the sort is called, e.g. "Name".
 * @param directions - How the directions are said (by default "newest first" and "oldest first").
 * @returns The sort.
 */
export function dateSort(
  label: string,
  directions: Readonly<Record<SortDirection, string>> = DATE_DIRECTIONS,
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

/**
 * Reads a table's state from the query string. A sort key, direction, page
 * or page size that isn't valid falls back to its default, each on its own.
 *
 * @param def - The table.
 * @param params - The page's query string.
 * @returns The state.
 */
export function parseTableState<K extends string>(
  def: TableDefinition<K>,
  params: SearchParams,
): TableState<K> {
  const sortValue = searchParam(params[`${def.prefix}sort`]);
  const sort = isSortKey(def, sortValue) ? sortValue : def.defaultSort;
  const dirValue = searchParam(params[`${def.prefix}dir`]);
  const dir = dirValue === 'asc' || dirValue === 'desc' ? dirValue : def.sorts[sort].first;
  const pageValue = searchParam(params[`${def.prefix}page`]);
  const page = pageValue && PAGE_PATTERN.test(pageValue) ? Number(pageValue) : 1;
  // Only the sizes as links write them: `50`, not `050` or `5e1`.
  const sizeValue = searchParam(params[`${def.prefix}size`]);
  const size = PAGE_SIZES.find((option) => String(option) === sizeValue) ?? DEFAULT_PAGE_SIZE;
  return { sort, dir, page, size };
}

/** The highest page a service is asked for; anything above is past any real list anyway. */
const MAX_PAGE = 999_999;

/**
 * Completes and checks the state a service was given, the same way as
 * {@link parseTableState}: services are called from pages, actions and
 * tests, and never trust it.
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
  const dir = state.dir === 'asc' || state.dir === 'desc' ? state.dir : def.sorts[sort].first;
  const page =
    typeof state.page === 'number' && Number.isSafeInteger(state.page) && state.page >= 1
      ? Math.min(state.page, MAX_PAGE)
      : 1;
  const size = isPageSize(state.size) ? state.size : DEFAULT_PAGE_SIZE;
  return { sort, dir, page, size };
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

/**
 * Says how a table is sorted, for its caption.
 *
 * @param def - The table.
 * @param state - Its state.
 * @returns E.g. "sorted by Name, A to Z".
 */
export function describeSort<K extends string>(
  def: TableDefinition<K>,
  state: TableState<K>,
): string {
  const sort = def.sorts[state.sort];
  return `sorted by ${sort.label}, ${sort.directions[state.dir]}`;
}

/** The links that change one table's state, keeping everything else on the page. */
export interface TableLinks<K extends string> {
  /** The table's state. */
  state: TableState<K>;
  /** The anchor of the card the table is in (`TableDefinition.section`), for its `Card`'s `id`. */
  section: string | undefined;
  /**
   * Shows another page.
   *
   * @param page - The page.
   * @returns The link.
   */
  pageHref(page: number): string;
  /**
   * Shows another number of rows per page, back on the first page.
   *
   * @param size - Rows per page.
   * @returns The link.
   */
  sizeHref(size: PageSize): string;
  /**
   * Changes the page's own parameters (e.g. a filter), back on this table's
   * first page.
   *
   * @param changes - The parameters to change; `undefined` or `''` removes one.
   * @returns The link.
   */
  withParams(changes: Record<string, string | undefined>): string;
  /**
   * This table's sort and page size, for the hidden fields of a search form
   * (`SearchForm`), so searching keeps them and starts on the first page.
   *
   * @returns Field names and values.
   */
  hiddenFields(): Record<string, string>;
  /**
   * The `aria-sort` of a column header, for screen readers: set when the
   * table is sorted by one of the column's sorts (a column can show more
   * than one, e.g. last active and joined).
   *
   * @param keys - The sort keys the column shows.
   * @returns `ascending` or `descending`, or `undefined` when sorted by another column.
   */
  ariaSort(...keys: K[]): AriaSort | undefined;
  /**
   * Every way to sort the table, in both directions (see `SortMenu`).
   *
   * @returns The choices.
   */
  sortOptions(): SortOption[];
  /**
   * The pagination control's links for a page of the table.
   *
   * @param paged - The page shown.
   * @param label - What the rows are, in the plural, e.g. "members".
   * @returns The control's content.
   */
  pagination(paged: Paged<unknown>, label: string): PaginationLinks;
  /**
   * The table's caption: what it shows, how it's sorted and, with several
   * pages, which one.
   *
   * @param base - What it shows, e.g. "Members of Adiutor".
   * @param paged - The page shown.
   * @returns E.g. "Members of Adiutor, sorted by Name, A to Z, page 2 of 3".
   */
  caption(base: string, paged: Paged<unknown>): string;
}

/** The links of a page's tables, built from its path and known parameters. */
export interface PageUrl {
  /**
   * Adds a table to the page and returns its links. Add every table of the
   * page before using any of the links (each link keeps the other tables'
   * state), with the page each one actually shows (`Paged.page`).
   *
   * @param def - The table.
   * @param state - Its state.
   * @returns Its links.
   */
  table<K extends string>(def: TableDefinition<K>, state: TableState<K>): TableLinks<K>;
  /**
   * The page as it is now: its own parameters and the state of every table
   * added so far, without an anchor. Where a confirmation comes back to
   * (`RecentConfirmationProvider`'s `returnTo`), so the tables keep their
   * sort and page; add every table first.
   *
   * @returns E.g. `/admin/staff?inv-page=2`.
   */
  current(): string;
}

/**
 * Builds a link to a page with some of its own parameters or one table's
 * state changed (see {@link createPageUrl}).
 *
 * @param params - The page's own parameters; empty ones are left out.
 * @param def - The table whose state changes, if any.
 * @param state - That table's new state.
 * @returns The link.
 */
type PageHref = (
  params: Readonly<Record<string, string | undefined>>,
  def?: TableDefinition,
  state?: TableState,
) => string;

/** The links that change one table's state (see {@link TableLinks}). */
class OneTableLinks<K extends string> implements TableLinks<K> {
  /**
   * Creates the links for one table on a page.
   *
   * @param href - Builds links to the page the table is on.
   * @param pageParams - The page's own parameters.
   * @param def - The table.
   * @param state - Its state.
   */
  constructor(
    private readonly href: PageHref,
    private readonly pageParams: Readonly<Record<string, string | undefined>>,
    private readonly def: TableDefinition<K>,
    readonly state: TableState<K>,
  ) {}

  /**
   * The anchor of the card the table is in.
   *
   * @returns The section ID, if the table has one.
   */
  get section(): string | undefined {
    return this.def.section;
  }

  /**
   * A link with this table in another state.
   *
   * @param next - The table's new state.
   * @returns The link.
   */
  private withState(next: TableState<K>): string {
    return this.href(this.pageParams, this.def, next);
  }

  /**
   * Shows another page.
   *
   * @param page - The page.
   * @returns The link.
   */
  pageHref(page: number): string {
    return this.withState({ ...this.state, page });
  }

  /**
   * Shows another number of rows per page, back on the first page.
   *
   * @param size - Rows per page.
   * @returns The link.
   */
  sizeHref(size: PageSize): string {
    return this.withState({ ...this.state, size, page: 1 });
  }

  /**
   * Changes the page's own parameters, back on this table's first page.
   *
   * @param changes - The parameters to change; `undefined` or `''` removes one.
   * @returns The link.
   */
  withParams(changes: Record<string, string | undefined>): string {
    return this.href({ ...this.pageParams, ...changes }, this.def, { ...this.state, page: 1 });
  }

  /**
   * This table's sort and page size, for a search form's hidden fields.
   *
   * @returns Field names and values.
   */
  hiddenFields(): Record<string, string> {
    return Object.fromEntries(tableQuery(this.def, { ...this.state, page: 1 }));
  }

  /**
   * The `aria-sort` of a column header.
   *
   * @param keys - The sort keys the column shows.
   * @returns `ascending` or `descending`, or `undefined` when sorted by another column.
   */
  ariaSort(...keys: K[]): AriaSort | undefined {
    if (!keys.includes(this.state.sort)) {
      return undefined;
    }
    return this.state.dir === 'asc' ? 'ascending' : 'descending';
  }

  /**
   * Every way to sort the table, each column in its first direction and
   * then the other.
   *
   * @returns The choices.
   */
  sortOptions(): SortOption[] {
    return (Object.keys(this.def.sorts) as K[]).flatMap((key) => {
      const sort = this.def.sorts[key];
      const order: SortDirection[] = sort.first === 'asc' ? ['asc', 'desc'] : ['desc', 'asc'];
      return order.map((dir) => ({
        value: `${key}-${dir}`,
        label: `${sort.label}, ${sort.directions[dir]}`,
        href: this.withState({ ...this.state, sort: key, dir, page: 1 }),
        current: this.state.sort === key && this.state.dir === dir,
      }));
    });
  }

  /**
   * The pagination control's links for a page of the table.
   *
   * @param paged - The page shown.
   * @param label - What the rows are, in the plural.
   * @returns The control's content.
   */
  pagination(paged: Paged<unknown>, label: string): PaginationLinks {
    const count = pageCount(paged.total, paged.size);
    return {
      label,
      page: paged.page,
      pageCount: count,
      total: paged.total,
      first: paged.total === 0 ? 0 : (paged.page - 1) * paged.size + 1,
      last: Math.min(paged.page * paged.size, paged.total),
      previousHref: paged.page > 1 ? this.pageHref(paged.page - 1) : null,
      nextHref: paged.page < count ? this.pageHref(paged.page + 1) : null,
      pages: pageWindow(paged.page, count).map((item) =>
        typeof item === 'number'
          ? { kind: 'page', page: item, href: this.pageHref(item), current: item === paged.page }
          : { kind: 'gap', key: item },
      ),
      sizes: PAGE_SIZES.map((size) => ({
        size,
        href: this.sizeHref(size),
        current: size === paged.size,
      })),
    };
  }

  /**
   * The table's caption.
   *
   * @param base - What it shows.
   * @param paged - The page shown.
   * @returns E.g. "Members of Adiutor, sorted by Name, A to Z, page 2 of 3".
   */
  caption(base: string, paged: Paged<unknown>): string {
    const count = pageCount(paged.total, paged.size);
    const page = count > 1 ? `, page ${paged.page} of ${count}` : '';
    return `${base}, ${describeSort(this.def, this.state)}${page}`;
  }
}

/**
 * Starts building the links of a page with tables.
 *
 * @param pathname - The page's path, e.g. `/admin/users`.
 * @param pageParams - The page's own parameters, in the order they appear in
 *   links (e.g. `{ filter, q }`); empty ones are left out.
 * @returns The page's links.
 */
export function createPageUrl(
  pathname: string,
  pageParams: Record<string, string | undefined> = {},
): PageUrl {
  const tables: { def: TableDefinition; state: TableState }[] = [];

  /**
   * Builds a link to the page; every link keeps the page's own parameters
   * and the other tables' state, and a link that changes a table with a
   * section ends in its anchor.
   *
   * @param params - The page's own parameters; empty ones are left out.
   * @param def - The table whose state changes, if any.
   * @param state - That table's new state.
   * @returns The link.
   */
  const href: PageHref = (params, def, state) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([name, value]) => {
      if (value) {
        query.append(name, value);
      }
    });
    tables.forEach((table) => {
      const current = table.def === def && state ? state : table.state;
      tableQuery(table.def, current).forEach(([name, value]) => query.append(name, value));
    });
    const search = query.toString();
    const path = search ? `${pathname}?${search}` : pathname;
    return state && def?.section ? withSection(path, def.section) : path;
  };

  /**
   * Adds a table to the page and returns its links.
   *
   * @param def - The table.
   * @param state - Its state.
   * @returns Its links.
   */
  const table = <K extends string>(def: TableDefinition<K>, state: TableState<K>) => {
    tables.push({ def, state });
    return new OneTableLinks(href, pageParams, def, state);
  };

  /**
   * The page as it is now: its own parameters and every table's state, without an anchor.
   *
   * @returns The link.
   */
  const current = () => href(pageParams);

  return { table, current };
}
