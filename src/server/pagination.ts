/**
 * @file Sorting and paging in SQL for the list services behind the app's
 * tables (their state comes from `src/lib/tables/table-state.ts`). Every sort ends
 * with the row's ID in the same direction (IDs are UUIDv7, so in creation
 * order), which makes the order stable across pages and its reverse exact.
 *
 * There are no indexes for these sorts yet: the per-company and per-user
 * lists are narrowed by their foreign key indexes first, and the global lists
 * (users, companies) are searched with `ILIKE '%…%'` and counted, which no
 * B-tree index helps with. Around 10,000 users or companies, add expression
 * indexes for the sorts and consider keyset pagination.
 */
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

import {
  clampPage,
  type Paged,
  type SortDirection,
  type TableState,
} from '@/lib/tables/table-state';
import type { PeopleSort } from '@/lib/tables/tables';

/**
 * Sorts people by the name that's shown for them: their name, trimmed, or
 * their email address without one (as `displayName()` in `src/lib/display-name.ts`
 * does), ignoring case.
 *
 * @param name - The name column.
 * @param email - The email column.
 * @returns The expression to sort by.
 */
function displayNameOrder(name: AnyColumn, email: AnyColumn): SQL {
  return sql`lower(coalesce(nullif(btrim(${name}), ''), ${email}))`;
}

/**
 * Sorts text ignoring case.
 *
 * @param column - The text column.
 * @returns The expression to sort by.
 */
export function textOrder(column: AnyColumn): SQL {
  return sql`lower(${column})`;
}

/**
 * Builds the ORDER BY terms of a sort: each expression in the same
 * direction, the last one usually the row's ID.
 *
 * @param dir - The direction.
 * @param expressions - What to sort by, most important first.
 * @returns The terms.
 */
export function orderTerms(dir: SortDirection, ...expressions: (AnyColumn | SQL)[]): SQL[] {
  return expressions.map((expression) =>
    dir === 'asc' ? sql`${expression} asc` : sql`${expression} desc`,
  );
}

/**
 * Builds the ORDER BY term of a date that may be missing (e.g. last active):
 * a missing date counts as the oldest, so it comes last when newest come
 * first and first the other way round.
 *
 * @param dir - The direction.
 * @param column - The date column.
 * @returns The term.
 */
function optionalDateOrder(dir: SortDirection, column: AnyColumn): SQL {
  return dir === 'asc' ? sql`${column} asc nulls first` : sql`${column} desc nulls last`;
}

/** The columns a list of people is sorted by (see {@link peopleOrder}). */
interface PeopleColumns {
  /** The person's name. */
  name: AnyColumn;
  /** Their email address. */
  email: AnyColumn;
  /** When they were last active (missing when never). */
  lastActiveAt: AnyColumn;
  /** What the list calls joining: the account's or a membership's creation date. */
  joined: AnyColumn;
  /** The row's ID, the final tie-breaker. */
  id: AnyColumn;
}

/**
 * The ORDER BY terms of a list of people (users, staff, members), the same
 * everywhere: by the name that's shown (then email), by email, by last
 * active (never counts as the oldest) or by when they joined.
 *
 * @param state - The table's state.
 * @param columns - The list's columns.
 * @returns The terms.
 */
export function peopleOrder(state: TableState<PeopleSort>, columns: PeopleColumns): SQL[] {
  const { dir } = state;
  switch (state.sort) {
    case 'email':
      return orderTerms(dir, columns.email, columns.id);
    case 'last-active':
      return [optionalDateOrder(dir, columns.lastActiveAt), ...orderTerms(dir, columns.id)];
    case 'joined':
      return orderTerms(dir, columns.joined, columns.id);
    default:
      return orderTerms(
        dir,
        displayNameOrder(columns.name, columns.email),
        columns.email,
        columns.id,
      );
  }
}

/**
 * Loads one page of a list: its rows and how many there are in all, at the
 * same time. A page past the end shows the last one instead, which takes
 * one more query.
 *
 * @param state - The table's state (sort, page, size).
 * @param count - Counts the rows on all pages.
 * @param rows - Loads the rows of one page, given how many and how many to skip.
 * @returns The page.
 */
export async function paginate<T>(
  state: TableState,
  count: () => Promise<number>,
  rows: (limit: number, offset: number) => Promise<T[]>,
): Promise<Paged<T>> {
  const { page, size } = state;
  const [total, items] = await Promise.all([count(), rows(size, (page - 1) * size)]);
  const shown = clampPage(page, total, size);
  if (shown === page) {
    return { items, total, page, size };
  }
  return { items: await rows(size, (shown - 1) * size), total, page: shown, size };
}

/**
 * Takes one page out of a whole list that's already filtered and sorted
 * (for filters that can't be written in SQL).
 *
 * @param all - Every row, in order.
 * @param state - The table's state (page, size).
 * @returns The page.
 */
export function slicePage<T>(all: T[], state: TableState): Paged<T> {
  const { size } = state;
  const page = clampPage(state.page, all.length, size);
  return { items: all.slice((page - 1) * size, page * size), total: all.length, page, size };
}
