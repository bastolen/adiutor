/**
 * @file Tests for the links of a page's tables: the links that change one
 * table while keeping the rest of the page, the anchors, the sort menu, the
 * pagination control and the caption. The state they are built from is tested
 * in `table-state.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { defined } from '@/lib/defined';
import translator from '@/lib/i18n/translator';

import { createPageUrl, type TableLinks } from './page-url';
import type { SearchParams } from './search-params';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  type PageSize,
  type Paged,
  parseTableState,
  resolveTableState,
  type TableState,
} from './table-state';
import { INVITATIONS_TABLE, type InvitationSort, type PeopleSort, USERS_TABLE } from './tables';

/** The path of the page the links are built for. */
const PATH = '/admin/users';

/** Sort names and captions in English (US), as a page would pass them. */
const T = translator('en-US', 'tables');

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
  const url = createPageUrl(PATH, setup.params ?? {}, T);
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

describe('the sort in a caption', () => {
  /**
   * The caption of a one-page users table in a state.
   *
   * @param params - The table's query parameters.
   * @returns The caption.
   */
  const usersCaption = (params: SearchParams) =>
    createPageUrl(PATH, {}, T)
      .table(USERS_TABLE, parseTableState(USERS_TABLE, params))
      .caption('Users', pagedOf(7));

  it('says how a table is sorted, in the words of its column', () => {
    expect(usersCaption({})).toBe('Users, sorted by Name, A to Z');
    expect(usersCaption({ dir: 'desc' })).toBe('Users, sorted by Name, Z to A');
    expect(usersCaption({ sort: 'last-active' })).toBe(
      'Users, sorted by Last active, most recent first',
    );
    expect(usersCaption({ sort: 'last-active', dir: 'asc' })).toBe(
      'Users, sorted by Last active, least recent first',
    );
    expect(usersCaption({ sort: 'joined' })).toBe('Users, sorted by Joined, newest first');
    /**
     * The caption of a one-page invitations table in a state.
     *
     * @param params - The table's query parameters.
     * @returns The caption.
     */
    const invitations = (params: SearchParams) =>
      createPageUrl(PATH, {}, T)
        .table(INVITATIONS_TABLE, parseTableState(INVITATIONS_TABLE, params))
        .caption('Open invitations', pagedOf(7));
    expect(invitations({})).toBe('Open invitations, sorted by Sent, newest first');
    expect(invitations({ 'inv-dir': 'asc' })).toBe(
      'Open invitations, sorted by Sent, oldest first',
    );
  });

  it.each([
    ['nl-NL', 'Gebruikers, gesorteerd op Naam, A tot Z, pagina 2 van 6'],
    ['es-ES', 'Usuarios (orden: Nombre, de la A a la Z; página 2 de 6)'],
  ] as const)('speaks %s', (locale, expected) => {
    const caption = createPageUrl(PATH, {}, translator(locale, 'tables'))
      .table(USERS_TABLE, parseTableState(USERS_TABLE, { page: '2' }))
      .caption(locale === 'nl-NL' ? 'Gebruikers' : 'Usuarios', pagedOf(132, 2));
    expect(caption).toBe(expected);
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
      const url = createPageUrl('/companies/adiutor-tests/members', {}, T);
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
      const url = createPageUrl(PATH, { q: 'amy@adiutor.test' }, T);
      const users = url.table(USERS_TABLE, parseTableState(USERS_TABLE, query));
      const href = users.pageHref(2);
      expect(href).toBe(`${PATH}?${BUSY_SEARCH}&sort=email&page=2`);
      expect(href).not.toContain('deleted');
      expect(href).not.toContain('connected');
      // Unless the page passes one as its own.
      expect(
        createPageUrl(PATH, { connected: 'github' }, T)
          .table(USERS_TABLE, parseTableState(USERS_TABLE, query))
          .pageHref(2),
      ).toBe(`${PATH}?connected=github&sort=email&page=2`);
    });

    it('list the tables in the order they were added to the page', () => {
      const url = createPageUrl(PATH, {}, T);
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
      const url = createPageUrl(PATH, BUSY.params ?? {}, T);
      url.table(USERS_TABLE, resolveTableState(USERS_TABLE, BUSY.users));
      url.table(INVITATIONS_TABLE, resolveTableState(INVITATIONS_TABLE, BUSY.invitations));
      expect(url.current()).toBe(`${PATH}?${BUSY_SEARCH}&page=3&size=50&${BUSY_INVITATIONS}`);
    });

    it('is the bare path with every table in its default state', () => {
      const url = createPageUrl(PATH, {}, T);
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
