/**
 * @file The links of a page's tables, built from its path and its known
 * parameters (`createPageUrl`): every link that changes one table's sort or
 * page keeps the page's own parameters (such as `q`) and every other table's
 * state, so one-off parameters such as `?connected=github` don't come back
 * after a sort. Links that change a table with a `section` end in that card's
 * anchor (`#invitations`), and `PageUrl.current()` is the page as it is, for
 * return addresses. The state itself (definitions, parsing, page maths) is in
 * `src/lib/tables/table-state.ts`. Pure and client-safe.
 */
import { withSection } from '@/lib/redirect';

import {
  type AriaSort,
  type PageSize,
  PAGE_SIZES,
  type Paged,
  pageCount,
  pageWindow,
  type PaginationLinks,
  type SortDefinition,
  type SortDirection,
  type SortOption,
  type TableDefinition,
  tableQuery,
  type TableState,
  type TablesTranslator,
} from './table-state';

/**
 * Names a sort and its direction, for the Sort menu and the caption.
 *
 * @param t - Translates the `tables` namespace.
 * @param sort - The sort.
 * @param dir - Its direction.
 * @returns The two names, e.g. `{ sort: 'Name', direction: 'A to Z' }`.
 */
function sortWords(
  t: TablesTranslator,
  sort: SortDefinition,
  dir: SortDirection,
): { sort: string; direction: string } {
  return { sort: t(`sorts.${sort.label}`), direction: t(`directions.${sort.directions[dir]}`) };
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
   * @returns E.g. `/admin/settings/staff?inv-page=2`.
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
   * @param t - Translates the `tables` namespace, for sort names and captions.
   */
  constructor(
    private readonly href: PageHref,
    private readonly pageParams: Readonly<Record<string, string | undefined>>,
    private readonly def: TableDefinition<K>,
    readonly state: TableState<K>,
    private readonly t: TablesTranslator,
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
        label: this.t('option', sortWords(this.t, sort, dir)),
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
    const words = sortWords(this.t, this.def.sorts[this.state.sort], this.state.dir);
    return count > 1
      ? this.t('captionPaged', { table: base, ...words, page: paged.page, pages: count })
      : this.t('caption', { table: base, ...words });
  }
}

/**
 * Starts building the links of a page with tables.
 *
 * @param pathname - The page's path, e.g. `/admin/users`.
 * @param pageParams - The page's own parameters, in the order they appear in
 *   links (e.g. `{ filter, q }`); empty ones are left out. Pass `{}` for none.
 * @param t - Translates the `tables` namespace (`getTranslations('tables')`).
 * @returns The page's links.
 */
export function createPageUrl(
  pathname: string,
  pageParams: Record<string, string | undefined>,
  t: TablesTranslator,
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
    return new OneTableLinks(href, pageParams, def, state, t);
  };

  /**
   * The page as it is now: its own parameters and every table's state, without an anchor.
   *
   * @returns The link.
   */
  const current = () => href(pageParams);

  return { table, current };
}
