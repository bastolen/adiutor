/**
 * @file Tests for the table state kept in the URL: reading it from a query
 * string, completing the state a service is given, and the sort and
 * pagination rules. The links that change it are tested in `page-url.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  clampPage,
  PAGINATION_THRESHOLD,
  pageCount,
  pageWindow,
  parseTableState,
  resolveTableState,
  showsPagination,
  type TableState,
  tableQuery,
} from './table-state';
import { INVITATIONS_TABLE, type PeopleSort, USERS_TABLE } from './tables';

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
