/**
 * @file Tests for the table state kept in the URL: reading it from a query
 * string, completing the state a service is given, the sort and pagination
 * rules, and the links that change one table while keeping the rest of the
 * page.
 */
import { describe, expect, it } from 'vitest';

import { defined } from '@/lib/defined';

import type { SearchParams } from './search-params';
import {
  clampPage,
  createPageUrl,
  DEFAULT_PAGE_SIZE,
  describeSort,
  PAGE_SIZES,
  type PageSize,
  type Paged,
  pageCount,
  pageWindow,
  PAGINATION_THRESHOLD,
  parseTableState,
  resolveTableState,
  showsPagination,
  type TableLinks,
  type TableState,
  tableQuery,
} from './table-state';
import { INVITATIONS_TABLE, type InvitationSort, type PeopleSort, USERS_TABLE } from './tables';

/** The path of the page the links are built for. */
const PATH = '/admin/users';

/**
 * Passes a value on as any type, to test how the code copes with what callers
 * hand it despite the types.
 *
 * @param value - The value.
 * @returns The same value, typed as `T`.
 */
function untyped<T>(value: unknown): T {
  return value as T;
}

/**
 * Counts from one number up to another.
 *
 * @param from - The first number.
 * @param to - The last number (included).
 * @returns The numbers.
 */
function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/**
 * Describes one page of a list, the way a list service returns it.
 *
 * @param total - How many rows there are on all pages.
 * @param page - The page shown.
 * @param size - Rows per page.
 * @returns The page, without rows.
 */
function pagedOf(total: number, page = 1, size: PageSize = DEFAULT_PAGE_SIZE): Paged<unknown> {
  return { items: [], total, page, size };
}

/**
 * Reads the query string of a link the way a page receives it.
 *
 * @param href - The link.
 * @returns Its query parameters.
 */
function searchParamsOf(href: string): SearchParams {
  return Object.fromEntries(new URL(href, 'https://adiutor.dev').searchParams);
}

/** What a page with a users table and open invitations starts from. */
interface PageSetup {
  /** The users table's state; whatever is left out is its default. */
  users?: Partial<TableState<PeopleSort>>;
  /** The invitations table's state; whatever is left out is its default. */
  invitations?: Partial<TableState<InvitationSort>>;
  /** The page's own parameters, in the order they appear in links. */
  params?: Record<string, string | undefined>;
}

/**
 * Builds the links of a page with the users table and, after it, the open
 * invitations (prefix `inv-`).
 *
 * @param setup - The state of both tables and the page's own parameters.
 * @returns The links of both tables.
 */
function pageLinks(setup: PageSetup = {}): {
  users: TableLinks<PeopleSort>;
  invitations: TableLinks<InvitationSort>;
} {
  const url = createPageUrl(PATH, setup.params);
  return {
    users: url.table(USERS_TABLE, resolveTableState(USERS_TABLE, setup.users)),
    invitations: url.table(
      INVITATIONS_TABLE,
      resolveTableState(INVITATIONS_TABLE, setup.invitations),
    ),
  };
}

/** A page where nothing is at its default: sorted, paged and searched, with a busy second table. */
const BUSY: PageSetup = {
  users: { sort: 'name', dir: 'asc', page: 3, size: 50 },
  invitations: { sort: 'email', dir: 'asc', page: 2, size: 100 },
  params: { q: 'amy@adiutor.test' },
};

/** The search of {@link BUSY} as it appears in links. */
const BUSY_SEARCH = 'q=amy%40adiutor.test';

/** The invitations table of {@link BUSY} as it appears in links. */
const BUSY_INVITATIONS = 'inv-sort=email&inv-page=2&inv-size=100';

/** The users table's state without any parameters. */
const USERS_DEFAULTS: TableState<PeopleSort> = { sort: 'name', dir: 'asc', page: 1, size: 25 };

describe('parseTableState', () => {
  it('gives the defaults when there are no parameters', () => {
    expect(parseTableState(USERS_TABLE, {})).toEqual(USERS_DEFAULTS);
    expect(parseTableState(INVITATIONS_TABLE, {})).toEqual({
      sort: 'sent',
      dir: 'desc',
      page: 1,
      size: 25,
    });
  });

  it('reads a valid sort, direction, page and size', () => {
    expect(
      parseTableState(USERS_TABLE, { sort: 'joined', dir: 'asc', page: '3', size: '50' }),
    ).toEqual({ sort: 'joined', dir: 'asc', page: 3, size: 50 });
    expect(
      parseTableState(USERS_TABLE, {
        sort: 'last-active',
        dir: 'desc',
        page: '999999',
        size: '100',
      }),
    ).toEqual({ sort: 'last-active', dir: 'desc', page: 999_999, size: 100 });
  });

  it.each(['', 'unknown', 'NAME', 'sent', '__proto__', 'constructor', 'toString'])(
    'falls back to the default sort for the unknown key "%s"',
    (sort) => {
      expect(parseTableState(USERS_TABLE, { sort })).toEqual(USERS_DEFAULTS);
    },
  );

  it.each([
    { sort: 'joined', dir: 'sideways', expected: 'desc' },
    { sort: 'last-active', dir: '', expected: 'desc' },
    { sort: 'email', dir: 'up', expected: 'asc' },
    { sort: 'name', dir: 'DESC', expected: 'asc' },
  ])(
    'falls back to the first direction of $sort for the direction "$dir"',
    ({ sort, dir, expected }) => {
      expect(parseTableState(USERS_TABLE, { sort, dir })).toMatchObject({ sort, dir: expected });
    },
  );

  it('reads the sort and the direction independently of each other', () => {
    // A direction alone reverses the default sort.
    expect(parseTableState(USERS_TABLE, { dir: 'desc' })).toEqual({
      ...USERS_DEFAULTS,
      dir: 'desc',
    });
    expect(parseTableState(INVITATIONS_TABLE, { 'inv-dir': 'asc' })).toMatchObject({
      sort: 'sent',
      dir: 'asc',
    });
    // A sort alone is in its first direction.
    expect(parseTableState(USERS_TABLE, { sort: 'joined' })).toMatchObject({
      sort: 'joined',
      dir: 'desc',
    });
    // An unknown sort doesn't take a valid direction down with it.
    expect(parseTableState(USERS_TABLE, { sort: 'unknown', dir: 'desc' })).toEqual({
      ...USERS_DEFAULTS,
      dir: 'desc',
    });
  });

  it.each(['1', '2', '12', '100000', '999999'])('reads the page "%s"', (page) => {
    expect(parseTableState(USERS_TABLE, { page }).page).toBe(Number(page));
  });

  it.each(['0', '-1', '1.5', '1e3', 'abc', '0012', '9999999', '', ' 2', '2 ', '+2', '0x10'])(
    'gives the first page for the page "%s"',
    (page) => {
      expect(parseTableState(USERS_TABLE, { page }).page).toBe(1);
    },
  );

  it.each([25, 50, 100])('accepts the page size %i', (size) => {
    expect(parseTableState(USERS_TABLE, { size: String(size) }).size).toBe(size);
  });

  it.each(['7', '50abc', '', '0', '-25', '25.5', 'abc', '101'])(
    'gives the default page size for the size "%s"',
    (size) => {
      expect(parseTableState(USERS_TABLE, { size }).size).toBe(25);
    },
  );

  it('counts a parameter given more than once as missing', () => {
    expect(
      parseTableState(USERS_TABLE, {
        sort: ['joined', 'email'],
        dir: ['desc', 'asc'],
        page: ['2', '3'],
        size: ['50', '100'],
      }),
    ).toEqual(USERS_DEFAULTS);
    expect(parseTableState(USERS_TABLE, { page: ['2'], size: ['50'] })).toMatchObject({
      page: 1,
      size: 25,
    });
    expect(
      parseTableState(USERS_TABLE, {
        sort: undefined,
        dir: undefined,
        page: undefined,
        size: undefined,
      }),
    ).toEqual(USERS_DEFAULTS);
  });

  it('reads a prefixed table from its own parameters only', () => {
    const params = { 'inv-sort': 'email', 'inv-dir': 'desc', 'inv-page': '2', 'inv-size': '100' };
    expect(parseTableState(INVITATIONS_TABLE, params)).toEqual({
      sort: 'email',
      dir: 'desc',
      page: 2,
      size: 100,
    });
    // `email` is a sort of both tables, but the plain parameters are the users table's.
    expect(
      parseTableState(INVITATIONS_TABLE, { sort: 'email', dir: 'desc', page: '4', size: '50' }),
    ).toEqual({
      sort: 'sent',
      dir: 'desc',
      page: 1,
      size: 25,
    });
    expect(parseTableState(USERS_TABLE, params)).toEqual(USERS_DEFAULTS);
  });

  it('reads two tables of one query string without mixing them up', () => {
    const params = { sort: 'joined', page: '2', 'inv-sort': 'email', 'inv-page': '5' };
    expect(parseTableState(USERS_TABLE, params)).toMatchObject({ sort: 'joined', page: 2 });
    expect(parseTableState(INVITATIONS_TABLE, params)).toMatchObject({ sort: 'email', page: 5 });
  });
});

describe('resolveTableState', () => {
  it('fills in everything that is missing', () => {
    expect(resolveTableState(USERS_TABLE)).toEqual(USERS_DEFAULTS);
    expect(resolveTableState(USERS_TABLE, {})).toEqual(USERS_DEFAULTS);
    expect(resolveTableState(INVITATIONS_TABLE, { sort: 'email' })).toEqual({
      sort: 'email',
      dir: 'asc',
      page: 1,
      size: 25,
    });
    expect(resolveTableState(USERS_TABLE, { dir: 'desc' })).toEqual({
      ...USERS_DEFAULTS,
      dir: 'desc',
    });
    expect(resolveTableState(USERS_TABLE, { page: 4, size: 100 })).toEqual({
      ...USERS_DEFAULTS,
      page: 4,
      size: 100,
    });
  });

  it('keeps a valid state as it is', () => {
    const state: TableState<PeopleSort> = { sort: 'last-active', dir: 'asc', page: 7, size: 50 };
    expect(resolveTableState(USERS_TABLE, state)).toEqual(state);
  });

  it('falls back for an unknown sort key, direction or size, each on its own', () => {
    expect(resolveTableState(USERS_TABLE, { sort: untyped('unknown') })).toEqual(USERS_DEFAULTS);
    expect(resolveTableState(USERS_TABLE, { sort: untyped('__proto__') })).toEqual(USERS_DEFAULTS);
    expect(resolveTableState(USERS_TABLE, { sort: untyped(42) })).toEqual(USERS_DEFAULTS);
    expect(resolveTableState(USERS_TABLE, { sort: 'joined', dir: untyped('sideways') })).toEqual({
      ...USERS_DEFAULTS,
      sort: 'joined',
      dir: 'desc',
    });
    expect(resolveTableState(USERS_TABLE, { sort: untyped('unknown'), dir: 'desc' })).toEqual({
      ...USERS_DEFAULTS,
      dir: 'desc',
    });
    expect(resolveTableState(USERS_TABLE, { size: untyped(7) }).size).toBe(25);
    expect(resolveTableState(USERS_TABLE, { size: untyped('50') }).size).toBe(25);
  });

  it.each([
    { page: 1, expected: 1 },
    { page: 2, expected: 2 },
    { page: 999_999, expected: 999_999 },
    { page: 1_000_000, expected: 999_999 },
    { page: Number.MAX_SAFE_INTEGER, expected: 999_999 },
    { page: 0, expected: 1 },
    { page: -1, expected: 1 },
    { page: 1.5, expected: 1 },
    { page: Number.NaN, expected: 1 },
    { page: Number.POSITIVE_INFINITY, expected: 1 },
    { page: untyped<number>('3'), expected: 1 },
  ])('turns the page $page into $expected', ({ page, expected }) => {
    expect(resolveTableState(USERS_TABLE, { page }).page).toBe(expected);
  });

  it('completes a state the same way parseTableState reads it', () => {
    [
      {},
      { sort: 'joined' },
      { dir: 'desc', size: '100' },
      { sort: 'email', dir: 'sideways', page: '0012' },
      { 'inv-sort': 'email', page: '9999999' },
    ].forEach((params) => {
      const parsed = parseTableState(USERS_TABLE, params);
      expect(resolveTableState(USERS_TABLE, parsed)).toEqual(parsed);
    });
  });
});

describe('tableQuery', () => {
  it('leaves out everything that is a default', () => {
    expect(tableQuery(USERS_TABLE, parseTableState(USERS_TABLE, {}))).toEqual([]);
    expect(tableQuery(INVITATIONS_TABLE, parseTableState(INVITATIONS_TABLE, {}))).toEqual([]);
  });

  it("leaves out a sort key's first direction and page 1, whatever the sort", () => {
    expect(tableQuery(USERS_TABLE, { sort: 'joined', dir: 'desc', page: 1, size: 25 })).toEqual([
      ['sort', 'joined'],
    ]);
    expect(tableQuery(USERS_TABLE, { sort: 'email', dir: 'asc', page: 1, size: 25 })).toEqual([
      ['sort', 'email'],
    ]);
  });

  it('adds each parameter that is not a default', () => {
    expect(tableQuery(USERS_TABLE, { ...USERS_DEFAULTS, dir: 'desc' })).toEqual([['dir', 'desc']]);
    expect(tableQuery(USERS_TABLE, { sort: 'joined', dir: 'asc', page: 1, size: 25 })).toEqual([
      ['sort', 'joined'],
      ['dir', 'asc'],
    ]);
    expect(tableQuery(USERS_TABLE, { sort: 'name', dir: 'asc', page: 3, size: 25 })).toEqual([
      ['page', '3'],
    ]);
    expect(tableQuery(USERS_TABLE, { sort: 'name', dir: 'asc', page: 1, size: 100 })).toEqual([
      ['size', '100'],
    ]);
  });

  it('always lists sort, direction, page and size in that order, with the prefix', () => {
    expect(tableQuery(USERS_TABLE, { sort: 'joined', dir: 'asc', page: 3, size: 100 })).toEqual([
      ['sort', 'joined'],
      ['dir', 'asc'],
      ['page', '3'],
      ['size', '100'],
    ]);
    expect(
      tableQuery(INVITATIONS_TABLE, { sort: 'email', dir: 'desc', page: 2, size: 50 }),
    ).toEqual([
      ['inv-sort', 'email'],
      ['inv-dir', 'desc'],
      ['inv-page', '2'],
      ['inv-size', '50'],
    ]);
    // The default sort of the invitations is newest first, so oldest first is not a default.
    expect(tableQuery(INVITATIONS_TABLE, { sort: 'sent', dir: 'asc', page: 1, size: 25 })).toEqual([
      ['inv-dir', 'asc'],
    ]);
  });

  it('gives a query that parseTableState reads back', () => {
    const states: TableState<PeopleSort>[] = [
      { sort: 'name', dir: 'asc', page: 1, size: 25 },
      { sort: 'name', dir: 'desc', page: 12, size: 50 },
      { sort: 'last-active', dir: 'asc', page: 1, size: 100 },
      { sort: 'joined', dir: 'desc', page: 999_999, size: 25 },
    ];
    states.forEach((state) => {
      const params = Object.fromEntries(tableQuery(USERS_TABLE, state));
      expect(parseTableState(USERS_TABLE, params)).toEqual(state);
    });
  });
});

describe('pageCount', () => {
  it('counts at least one page, even for an empty list', () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(1, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
  });

  it('rounds up to the next page', () => {
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(132, 25)).toBe(6);
    expect(pageCount(100, 100)).toBe(1);
    expect(pageCount(101, 100)).toBe(2);
  });
});

describe('clampPage', () => {
  it('keeps a page that exists', () => {
    expect(clampPage(1, 132, 25)).toBe(1);
    expect(clampPage(2, 132, 25)).toBe(2);
    expect(clampPage(6, 132, 25)).toBe(6);
  });

  it('gives the last page for a page past the end', () => {
    expect(clampPage(7, 132, 25)).toBe(6);
    expect(clampPage(999_999, 132, 25)).toBe(6);
    expect(clampPage(3, 50, 25)).toBe(2);
  });

  it('gives page 1 for an empty list or a page before the start', () => {
    expect(clampPage(5, 0, 25)).toBe(1);
    expect(clampPage(1, 0, 25)).toBe(1);
    expect(clampPage(0, 132, 25)).toBe(1);
    expect(clampPage(-3, 132, 25)).toBe(1);
  });
});

describe('showsPagination', () => {
  it('shows it only above the threshold', () => {
    expect(PAGINATION_THRESHOLD).toBe(10);
    expect(showsPagination(0)).toBe(false);
    expect(showsPagination(10)).toBe(false);
    expect(showsPagination(11)).toBe(true);
    expect(showsPagination(132)).toBe(true);
  });
});

describe('pageWindow', () => {
  it.each([1, 2, 7])('shows every page number of %i pages', (count) => {
    range(1, count).forEach((page) => {
      expect(pageWindow(page, count)).toEqual(range(1, count));
    });
  });

  it.each([
    { page: 1, expected: [1, 2, 'gap-end', 8] },
    { page: 2, expected: [1, 2, 3, 'gap-end', 8] },
    { page: 3, expected: [1, 2, 3, 4, 'gap-end', 8] },
    { page: 4, expected: [1, 2, 3, 4, 5, 'gap-end', 8] },
    { page: 5, expected: [1, 'gap-start', 4, 5, 6, 7, 8] },
    { page: 6, expected: [1, 'gap-start', 5, 6, 7, 8] },
    { page: 7, expected: [1, 'gap-start', 6, 7, 8] },
    { page: 8, expected: [1, 'gap-start', 7, 8] },
  ])('starts leaving pages out at 8 pages: page $page', ({ page, expected }) => {
    expect(pageWindow(page, 8)).toEqual(expected);
  });

  it.each([
    { page: 1, expected: [1, 2, 'gap-end', 20] },
    { page: 2, expected: [1, 2, 3, 'gap-end', 20] },
    { page: 3, expected: [1, 2, 3, 4, 'gap-end', 20] },
    { page: 4, expected: [1, 2, 3, 4, 5, 'gap-end', 20] },
    { page: 5, expected: [1, 'gap-start', 4, 5, 6, 'gap-end', 20] },
    { page: 10, expected: [1, 'gap-start', 9, 10, 11, 'gap-end', 20] },
    { page: 16, expected: [1, 'gap-start', 15, 16, 17, 'gap-end', 20] },
    { page: 17, expected: [1, 'gap-start', 16, 17, 18, 19, 20] },
    { page: 18, expected: [1, 'gap-start', 17, 18, 19, 20] },
    { page: 19, expected: [1, 'gap-start', 18, 19, 20] },
    { page: 20, expected: [1, 'gap-start', 19, 20] },
  ])('shows the ends and the neighbours of 20 pages: page $page', ({ page, expected }) => {
    expect(pageWindow(page, 20)).toEqual(expected);
  });

  it('shows a page instead of a gap of exactly one page', () => {
    // Page 4 of 20: page 2 is the only one between 1 and 3.
    expect(pageWindow(4, 20).slice(0, 4)).toEqual([1, 2, 3, 4]);
    // Page 17 of 20: page 19 is the only one between 18 and 20.
    expect(pageWindow(17, 20).slice(-3)).toEqual([18, 19, 20]);
    // A gap of two pages stays a gap: pages 2 and 3 are left out for page 5.
    expect(pageWindow(5, 20).slice(0, 3)).toEqual([1, 'gap-start', 4]);
  });

  it('puts the gaps on their side of the current page, hiding at least two pages each', () => {
    range(8, 30).forEach((count) => {
      range(1, count).forEach((page) => {
        const items = pageWindow(page, count);
        const current = items.indexOf(page);
        const numbers = items.filter((item): item is number => typeof item === 'number');

        expect(current).toBeGreaterThan(-1);
        expect(items.length).toBeLessThanOrEqual(7);
        expect(numbers[0]).toBe(1);
        expect(numbers.at(-1)).toBe(count);
        expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
        expect(new Set(numbers).size).toBe(numbers.length);
        expect(items.filter((item) => item === 'gap-start').length).toBeLessThanOrEqual(1);
        expect(items.filter((item) => item === 'gap-end').length).toBeLessThanOrEqual(1);
        items.forEach((item, index) => {
          if (item === 'gap-start') {
            expect(index).toBeLessThan(current);
          }
          if (item === 'gap-end') {
            expect(index).toBeGreaterThan(current);
          }
          const next = items[index + 1];
          if (typeof item === 'number' && typeof next === 'number') {
            expect(next - item).toBe(1);
          }
          if (typeof item === 'string') {
            const hidden = (items[index + 1] as number) - (items[index - 1] as number) - 1;
            expect(hidden).toBeGreaterThanOrEqual(2);
          }
        });
      });
    });
  });
});

describe('describeSort', () => {
  it('says how a table is sorted, in the words of its column', () => {
    expect(describeSort(USERS_TABLE, parseTableState(USERS_TABLE, {}))).toBe(
      'sorted by Name, A to Z',
    );
    expect(describeSort(USERS_TABLE, parseTableState(USERS_TABLE, { dir: 'desc' }))).toBe(
      'sorted by Name, Z to A',
    );
    expect(describeSort(USERS_TABLE, parseTableState(USERS_TABLE, { sort: 'last-active' }))).toBe(
      'sorted by Last active, most recent first',
    );
    expect(
      describeSort(USERS_TABLE, parseTableState(USERS_TABLE, { sort: 'last-active', dir: 'asc' })),
    ).toBe('sorted by Last active, least recent first');
    expect(describeSort(USERS_TABLE, parseTableState(USERS_TABLE, { sort: 'joined' }))).toBe(
      'sorted by Joined, newest first',
    );
    expect(describeSort(INVITATIONS_TABLE, parseTableState(INVITATIONS_TABLE, {}))).toBe(
      'sorted by Sent, newest first',
    );
    expect(
      describeSort(INVITATIONS_TABLE, parseTableState(INVITATIONS_TABLE, { 'inv-dir': 'asc' })),
    ).toBe('sorted by Sent, oldest first');
  });
});

describe('createPageUrl', () => {
  describe('links', () => {
    it('are the bare path for a table in its default state', () => {
      const { users, invitations } = pageLinks();
      expect(users.pageHref(1)).toBe(PATH);
      expect(users.sizeHref(DEFAULT_PAGE_SIZE)).toBe(PATH);
      expect(users.withParams({})).toBe(PATH);
      // A table that isn't the page's main one ends in its card's anchor.
      expect(invitations.pageHref(1)).toBe(`${PATH}#invitations`);
      // Sorting back to the default gives the bare path as well.
      expect(
        pageLinks({ users: { dir: 'desc' } })
          .users.sortOptions()
          .find((option) => option.value === 'name-asc')?.href,
      ).toBe(PATH);
    });

    it('use the path they were given', () => {
      const url = createPageUrl('/companies/adiutor-tests/members');
      const links = url.table(USERS_TABLE, resolveTableState(USERS_TABLE));
      expect(links.pageHref(1)).toBe('/companies/adiutor-tests/members');
      expect(links.pageHref(2)).toBe('/companies/adiutor-tests/members?page=2');
    });

    it("start with the page's own parameters in the order they were given, then the tables", () => {
      const params = { filter: 'staff', q: 'amy' };
      expect(pageLinks({ params }).users.pageHref(1)).toBe(`${PATH}?filter=staff&q=amy`);
      expect(pageLinks({ params: { q: 'amy', filter: 'staff' } }).users.pageHref(1)).toBe(
        `${PATH}?q=amy&filter=staff`,
      );
      expect(
        pageLinks({ params, users: { sort: 'email' }, invitations: { page: 2 } }).users.pageHref(3),
      ).toBe(`${PATH}?filter=staff&q=amy&sort=email&page=3&inv-page=2`);
    });

    it('leave out page parameters that are empty or undefined', () => {
      const params = { filter: '', q: 'amy', sort: undefined, other: undefined };
      expect(pageLinks({ params }).users.pageHref(1)).toBe(`${PATH}?q=amy`);
      expect(pageLinks({ params: { filter: '', q: undefined } }).users.pageHref(1)).toBe(PATH);
    });

    it('encode the values of page parameters', () => {
      const { users } = pageLinks({ params: { q: 'amy tester+1@adiutor.test' } });
      expect(users.pageHref(1)).toBe(`${PATH}?q=amy+tester%2B1%40adiutor.test`);
      expect(searchParamsOf(users.pageHref(1))).toEqual({ q: 'amy tester+1@adiutor.test' });
    });

    it("never carry parameters of the address that are not the page's or a table's", () => {
      const query: SearchParams = {
        q: 'amy@adiutor.test',
        sort: 'email',
        deleted: '1',
        connected: 'github',
      };
      const url = createPageUrl(PATH, { q: 'amy@adiutor.test' });
      const users = url.table(USERS_TABLE, parseTableState(USERS_TABLE, query));
      const href = users.pageHref(2);
      expect(href).toBe(`${PATH}?${BUSY_SEARCH}&sort=email&page=2`);
      expect(href).not.toContain('deleted');
      expect(href).not.toContain('connected');
      // Unless the page passes one as its own.
      expect(
        createPageUrl(PATH, { connected: 'github' })
          .table(USERS_TABLE, parseTableState(USERS_TABLE, query))
          .pageHref(2),
      ).toBe(`${PATH}?connected=github&sort=email&page=2`);
    });

    it('list the tables in the order they were added to the page', () => {
      const url = createPageUrl(PATH);
      const invitations = url.table(
        INVITATIONS_TABLE,
        resolveTableState(INVITATIONS_TABLE, { page: 2 }),
      );
      url.table(USERS_TABLE, resolveTableState(USERS_TABLE, { page: 3 }));
      expect(invitations.pageHref(2)).toBe(`${PATH}?inv-page=2&page=3#invitations`);
    });
  });

  describe('section anchors', () => {
    it("end every link that changes a table with a section in its card's anchor", () => {
      const { users, invitations } = pageLinks(BUSY);
      expect(invitations.pageHref(3)).toMatch(/#invitations$/);
      expect(invitations.sizeHref(25)).toMatch(/#invitations$/);
      invitations.sortOptions().forEach((option) => {
        expect(option.href).toMatch(/#invitations$/);
      });
      invitations.pagination(pagedOf(500, 2, 100), 'invitations').pages.forEach((item) => {
        if (item.kind === 'page') {
          expect(item.href).toMatch(/#invitations$/);
        }
      });
      expect(invitations.section).toBe('invitations');
      // The main table has none, so its links show the top of the page.
      expect(users.section).toBeUndefined();
      expect(users.pageHref(4)).not.toContain('#');
      users.sortOptions().forEach((option) => {
        expect(option.href).not.toContain('#');
      });
    });
  });

  describe('current', () => {
    it('is the page with its own parameters and every table as it is, without an anchor', () => {
      const url = createPageUrl(PATH, BUSY.params);
      url.table(USERS_TABLE, resolveTableState(USERS_TABLE, BUSY.users));
      url.table(INVITATIONS_TABLE, resolveTableState(INVITATIONS_TABLE, BUSY.invitations));
      expect(url.current()).toBe(`${PATH}?${BUSY_SEARCH}&page=3&size=50&${BUSY_INVITATIONS}`);
    });

    it('is the bare path with every table in its default state', () => {
      const url = createPageUrl(PATH);
      url.table(INVITATIONS_TABLE, resolveTableState(INVITATIONS_TABLE));
      expect(url.current()).toBe(PATH);
    });
  });

  describe('sort links', () => {
    it("keep the other table's state and the page's own parameters", () => {
      const { invitations } = pageLinks(BUSY);
      const hrefs = Object.fromEntries(
        invitations.sortOptions().map((option) => [option.value, option.href]),
      );
      expect(hrefs['email-desc']).toBe(
        `${PATH}?${BUSY_SEARCH}&page=3&size=50&inv-sort=email&inv-dir=desc&inv-size=100#invitations`,
      );
      expect(hrefs['sent-desc']).toBe(
        `${PATH}?${BUSY_SEARCH}&page=3&size=50&inv-size=100#invitations`,
      );
    });

    it('do not change the links built before or after them', () => {
      const { users } = pageLinks(BUSY);
      const before = users.pageHref(4);
      users.sortOptions();
      expect(users.pageHref(4)).toBe(before);
      expect(users.state).toEqual({ sort: 'name', dir: 'asc', page: 3, size: 50 });
    });
  });

  describe('pageHref', () => {
    it('shows another page, keeping the rest', () => {
      const { users, invitations } = pageLinks(BUSY);
      expect(users.pageHref(4)).toBe(`${PATH}?${BUSY_SEARCH}&page=4&size=50&${BUSY_INVITATIONS}`);
      expect(invitations.pageHref(1)).toBe(
        `${PATH}?${BUSY_SEARCH}&page=3&size=50&inv-sort=email&inv-size=100#invitations`,
      );
    });
  });

  describe('sizeHref', () => {
    it('shows another size and goes back to the first page', () => {
      const { users } = pageLinks(BUSY);
      expect(users.sizeHref(100)).toBe(`${PATH}?${BUSY_SEARCH}&size=100&${BUSY_INVITATIONS}`);
      expect(users.sizeHref(25)).toBe(`${PATH}?${BUSY_SEARCH}&${BUSY_INVITATIONS}`);
    });

    it('keeps the sort', () => {
      const { users } = pageLinks({ users: { sort: 'joined', dir: 'asc', page: 4 } });
      expect(users.sizeHref(50)).toBe(`${PATH}?sort=joined&dir=asc&size=50`);
    });
  });

  describe('withParams', () => {
    it("changes the page's parameters and goes back to this table's first page", () => {
      const { users } = pageLinks(BUSY);
      expect(users.withParams({ filter: 'staff' })).toBe(
        `${PATH}?${BUSY_SEARCH}&filter=staff&size=50&${BUSY_INVITATIONS}`,
      );
      expect(users.withParams({ q: 'jane@adiutor.test' })).toBe(
        `${PATH}?q=jane%40adiutor.test&size=50&${BUSY_INVITATIONS}`,
      );
    });

    it('removes a parameter set to undefined or an empty string', () => {
      const { users } = pageLinks({ ...BUSY, params: { filter: 'staff', q: 'amy' } });
      expect(users.withParams({ filter: undefined })).toBe(
        `${PATH}?q=amy&size=50&${BUSY_INVITATIONS}`,
      );
      expect(users.withParams({ q: '' })).toBe(`${PATH}?filter=staff&size=50&${BUSY_INVITATIONS}`);
    });

    it("keeps the other table's page", () => {
      const { invitations } = pageLinks(BUSY);
      expect(invitations.withParams({ q: 'amy' })).toBe(
        `${PATH}?q=amy&page=3&size=50&inv-sort=email&inv-size=100#invitations`,
      );
    });

    it('leaves the parameters of later links alone', () => {
      const { users } = pageLinks({ params: { q: 'amy' } });
      users.withParams({ q: 'jane', filter: 'staff' });
      expect(users.pageHref(2)).toBe(`${PATH}?q=amy&page=2`);
    });
  });

  describe('hiddenFields', () => {
    it('is empty for a table in its default state', () => {
      expect(pageLinks().users.hiddenFields()).toEqual({});
    });

    it('has the sort and size but never the page', () => {
      const { users, invitations } = pageLinks(BUSY);
      expect(users.hiddenFields()).toEqual({ size: '50' });
      expect(invitations.hiddenFields()).toEqual({ 'inv-sort': 'email', 'inv-size': '100' });
      expect(
        pageLinks({
          users: { sort: 'joined', dir: 'asc', page: 9, size: 100 },
        }).users.hiddenFields(),
      ).toEqual({ sort: 'joined', dir: 'asc', size: '100' });
    });
  });

  describe('ariaSort', () => {
    it('is set only for the column the table is sorted by, in its direction', () => {
      const { users } = pageLinks({ users: { sort: 'email', dir: 'desc' } });
      expect(users.ariaSort('email')).toBe('descending');
      expect(users.ariaSort('name')).toBeUndefined();
      expect(users.ariaSort('last-active', 'joined')).toBeUndefined();
      expect(pageLinks().users.ariaSort('name')).toBe('ascending');
    });

    it('is set for a column that shows more than one sort when either is used', () => {
      expect(
        pageLinks({ users: { sort: 'joined', dir: 'asc' } }).users.ariaSort(
          'last-active',
          'joined',
        ),
      ).toBe('ascending');
      expect(
        pageLinks({ users: { sort: 'last-active' } }).users.ariaSort('last-active', 'joined'),
      ).toBe('descending');
    });
  });

  describe('sortOptions', () => {
    it('gives each column in its first direction and then the other', () => {
      const { users, invitations } = pageLinks();
      expect(users.sortOptions().map(({ value, label }) => ({ value, label }))).toEqual([
        { value: 'name-asc', label: 'Name, A to Z' },
        { value: 'name-desc', label: 'Name, Z to A' },
        { value: 'email-asc', label: 'Email, A to Z' },
        { value: 'email-desc', label: 'Email, Z to A' },
        { value: 'last-active-desc', label: 'Last active, most recent first' },
        { value: 'last-active-asc', label: 'Last active, least recent first' },
        { value: 'joined-desc', label: 'Joined, newest first' },
        { value: 'joined-asc', label: 'Joined, oldest first' },
      ]);
      expect(invitations.sortOptions().map(({ value }) => value)).toEqual([
        'email-asc',
        'email-desc',
        'sent-desc',
        'sent-asc',
      ]);
    });

    it.each([
      { sort: 'name', dir: 'asc' },
      { sort: 'name', dir: 'desc' },
      { sort: 'email', dir: 'asc' },
      { sort: 'email', dir: 'desc' },
      { sort: 'last-active', dir: 'desc' },
      { sort: 'last-active', dir: 'asc' },
      { sort: 'joined', dir: 'desc' },
      { sort: 'joined', dir: 'asc' },
    ] as const)(
      'marks only $sort $dir as current when the table is sorted that way',
      ({ sort, dir }) => {
        const { users } = pageLinks({ users: { sort, dir } });
        expect(users.sortOptions().filter((option) => option.current)).toEqual([
          expect.objectContaining({ value: `${sort}-${dir}` }),
        ]);
      },
    );

    it('links to the sort it names, on the first page and with the size kept', () => {
      const { users } = pageLinks(BUSY);
      users.sortOptions().forEach((option) => {
        const state = parseTableState(USERS_TABLE, searchParamsOf(option.href));
        expect(option.value).toBe(`${state.sort}-${state.dir}`);
        expect(state).toMatchObject({ page: 1, size: 50 });
        expect(searchParamsOf(option.href)).toMatchObject({
          q: 'amy@adiutor.test',
          'inv-page': '2',
        });
      });
    });
  });

  describe('pagination', () => {
    it('numbers the rows of a page, with links to the pages around it', () => {
      const { users } = pageLinks({ users: { page: 2 } });
      const links = users.pagination(pagedOf(132, 2), 'users');
      expect(links).toMatchObject({
        label: 'users',
        page: 2,
        pageCount: 6,
        total: 132,
        first: 26,
        last: 50,
        previousHref: PATH,
        nextHref: `${PATH}?page=3`,
      });
    });

    it('has no previous link on the first page', () => {
      const links = pageLinks().users.pagination(pagedOf(132), 'users');
      expect(links).toMatchObject({
        first: 1,
        last: 25,
        previousHref: null,
        nextHref: `${PATH}?page=2`,
      });
    });

    it('has no next link on the last page, which ends at the last row', () => {
      const links = pageLinks({ users: { page: 6 } }).users.pagination(pagedOf(132, 6), 'users');
      expect(links).toMatchObject({
        page: 6,
        pageCount: 6,
        first: 126,
        last: 132,
        previousHref: `${PATH}?page=5`,
        nextHref: null,
      });
      const full = pageLinks({ users: { page: 2 } }).users.pagination(pagedOf(50, 2), 'users');
      expect(full).toMatchObject({ first: 26, last: 50, previousHref: PATH, nextHref: null });
    });

    it('has neither link, and no row numbers, for an empty list', () => {
      const links = pageLinks().users.pagination(pagedOf(0), 'users');
      expect(links).toMatchObject({
        page: 1,
        pageCount: 1,
        total: 0,
        first: 0,
        last: 0,
        previousHref: null,
        nextHref: null,
      });
      expect(links.pages).toEqual([{ kind: 'page', page: 1, href: PATH, current: true }]);
    });

    it('has a link for every page number, marking the one shown', () => {
      const { users } = pageLinks({ users: { page: 2 } });
      expect(users.pagination(pagedOf(132, 2), 'users').pages).toEqual(
        range(1, 6).map((page) => ({
          kind: 'page',
          page,
          href: page === 1 ? PATH : `${PATH}?page=${page}`,
          current: page === 2,
        })),
      );
    });

    it('has gaps without links between the page numbers of a long list', () => {
      const { users } = pageLinks({ users: { page: 10 } });
      expect(users.pagination(pagedOf(500, 10), 'users').pages).toEqual([
        { kind: 'page', page: 1, href: PATH, current: false },
        { kind: 'gap', key: 'gap-start' },
        { kind: 'page', page: 9, href: `${PATH}?page=9`, current: false },
        { kind: 'page', page: 10, href: `${PATH}?page=10`, current: true },
        { kind: 'page', page: 11, href: `${PATH}?page=11`, current: false },
        { kind: 'gap', key: 'gap-end' },
        { kind: 'page', page: 20, href: `${PATH}?page=20`, current: false },
      ]);
    });

    it('has a link for every page size, back on the first page, marking the one used', () => {
      const { users } = pageLinks({ users: { page: 2 } });
      expect(users.pagination(pagedOf(132, 2), 'users').sizes).toEqual([
        { size: 25, href: PATH, current: true },
        { size: 50, href: `${PATH}?size=50`, current: false },
        { size: 100, href: `${PATH}?size=100`, current: false },
      ]);
      expect(PAGE_SIZES).toEqual([25, 50, 100]);

      const bigger = pageLinks({ users: { page: 2, size: 50 } }).users;
      expect(bigger.pagination(pagedOf(132, 2, 50), 'users').sizes).toEqual([
        { size: 25, href: PATH, current: false },
        { size: 50, href: `${PATH}?size=50`, current: true },
        { size: 100, href: `${PATH}?size=100`, current: false },
      ]);
    });

    it("keeps the sort, the other table and the page's parameters in every link", () => {
      const { users } = pageLinks({
        users: { sort: 'email', page: 2, size: 50 },
        invitations: { page: 3 },
        params: { q: 'amy' },
      });
      const links = users.pagination(pagedOf(132, 2, 50), 'users');
      expect(links.previousHref).toBe(`${PATH}?q=amy&sort=email&size=50&inv-page=3`);
      expect(links.nextHref).toBe(`${PATH}?q=amy&sort=email&page=3&size=50&inv-page=3`);
      expect(defined(links.sizes[0], 'the first page size').href).toBe(
        `${PATH}?q=amy&sort=email&inv-page=3`,
      );
      expect(defined(links.sizes[2], 'the third page size').href).toBe(
        `${PATH}?q=amy&sort=email&size=100&inv-page=3`,
      );
    });
  });

  describe('caption', () => {
    it('says what the table shows and how it is sorted', () => {
      const { users, invitations } = pageLinks();
      expect(users.caption('Members of Adiutor Tests', pagedOf(7))).toBe(
        'Members of Adiutor Tests, sorted by Name, A to Z',
      );
      expect(invitations.caption('Open invitations', pagedOf(7))).toBe(
        'Open invitations, sorted by Sent, newest first',
      );
      expect(pageLinks({ users: { sort: 'last-active' } }).users.caption('Users', pagedOf(7))).toBe(
        'Users, sorted by Last active, most recent first',
      );
    });

    it('has no page when everything fits on one', () => {
      const { users } = pageLinks();
      expect(users.caption('Users', pagedOf(0))).toBe('Users, sorted by Name, A to Z');
      expect(users.caption('Users', pagedOf(25))).toBe('Users, sorted by Name, A to Z');
    });

    it('adds the page when there is more than one', () => {
      const { users } = pageLinks({ users: { page: 2 } });
      expect(users.caption('Users', pagedOf(132, 2))).toBe(
        'Users, sorted by Name, A to Z, page 2 of 6',
      );
      expect(users.caption('Users', pagedOf(26, 1))).toBe(
        'Users, sorted by Name, A to Z, page 1 of 2',
      );
      expect(users.caption('Users', pagedOf(132, 2, 100))).toBe(
        'Users, sorted by Name, A to Z, page 2 of 2',
      );
    });
  });
});
