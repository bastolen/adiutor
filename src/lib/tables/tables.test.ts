/**
 * @file Tests for the app's table definitions: each table's default order,
 * its sorts, the query parameters of tables that share a page, and the
 * anchors of their cards.
 */
import { describe, expect, it } from 'vitest';

import { defined } from '@/lib/defined';
import { isSectionId } from '@/lib/redirect';

import { parseTableState, type SortDirection, type TableDefinition } from './table-state';
import {
  AUDIT_LOG_TABLE,
  COMPANIES_TABLE,
  DEVICES_TABLE,
  ERRORS_TABLE,
  INVITATIONS_TABLE,
  INVITE_LINKS_TABLE,
  MEMBERS_TABLE,
  STAFF_TABLE,
  USER_COMPANIES_TABLE,
  USERS_TABLE,
} from './tables';

/** One table with the order it shows until the viewer picks another. */
interface TableCase {
  /** The table's constant, for the test's name. */
  name: string;
  /** The table. */
  table: TableDefinition;
  /** The sort key it starts with. */
  sort: string;
  /** The direction it starts with. */
  dir: SortDirection;
}

/**
 * Every table with its default order: names A to Z; invitations, links,
 * devices, audit events and errors newest first.
 */
const TABLES: TableCase[] = [
  { name: 'USERS_TABLE', table: USERS_TABLE, sort: 'name', dir: 'asc' },
  { name: 'STAFF_TABLE', table: STAFF_TABLE, sort: 'name', dir: 'asc' },
  { name: 'MEMBERS_TABLE', table: MEMBERS_TABLE, sort: 'name', dir: 'asc' },
  { name: 'COMPANIES_TABLE', table: COMPANIES_TABLE, sort: 'name', dir: 'asc' },
  { name: 'USER_COMPANIES_TABLE', table: USER_COMPANIES_TABLE, sort: 'name', dir: 'asc' },
  { name: 'INVITATIONS_TABLE', table: INVITATIONS_TABLE, sort: 'sent', dir: 'desc' },
  { name: 'INVITE_LINKS_TABLE', table: INVITE_LINKS_TABLE, sort: 'created', dir: 'desc' },
  { name: 'DEVICES_TABLE', table: DEVICES_TABLE, sort: 'signed-in', dir: 'desc' },
  { name: 'AUDIT_LOG_TABLE', table: AUDIT_LOG_TABLE, sort: 'time', dir: 'desc' },
  { name: 'ERRORS_TABLE', table: ERRORS_TABLE, sort: 'time', dir: 'desc' },
];

/** The query parameters every table has, after its prefix. */
const TABLE_PARAMS = ['sort', 'dir', 'page', 'size'];

/**
 * The parameters pages use for themselves (search, filters, the audit log's
 * group and dates), which no table may take.
 */
const PAGE_PARAMS = ['q', 'filter', 'group', 'from', 'to'];

/**
 * Lists the query parameters of tables, with their prefixes.
 *
 * @param tables - The tables.
 * @returns Every parameter name of every table.
 */
function paramNames(tables: TableDefinition[]): string[] {
  return tables.flatMap(({ prefix }) => TABLE_PARAMS.map((param) => `${prefix}${param}`));
}

describe('table definitions', () => {
  describe.each(TABLES)('$name', ({ table, sort, dir }) => {
    it('has a default sort that is one of its sorts', () => {
      expect(Object.keys(table.sorts)).toContain(table.defaultSort);
      expect(table.defaultSort).toBe(sort);
    });

    it('starts in the default direction', () => {
      expect(defined(table.sorts[table.defaultSort], 'the default sort').first).toBe(dir);
      expect(parseTableState(table, {})).toEqual({ sort, dir, page: 1, size: 25 });
    });

    it('names its sorts so they can appear in a URL, with message keys for both directions', () => {
      Object.entries(table.sorts).forEach(([key, definition]) => {
        expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/);
        expect(definition.label).not.toBe('');
        expect(['asc', 'desc']).toContain(definition.first);
        expect(definition.directions.asc).not.toBe('');
        expect(definition.directions.desc).not.toBe('');
        expect(definition.directions.asc).not.toBe(definition.directions.desc);
      });
    });

    it('has no prefix, or one that ends in a hyphen', () => {
      expect(table.prefix).toMatch(/^([a-z]+-)?$/);
    });
  });

  it('sorts names A to Z first and dates newest first', () => {
    const byName: TableDefinition[] = [
      USERS_TABLE,
      STAFF_TABLE,
      MEMBERS_TABLE,
      COMPANIES_TABLE,
      USER_COMPANIES_TABLE,
    ];
    const byDate: TableDefinition[] = [INVITATIONS_TABLE, INVITE_LINKS_TABLE, DEVICES_TABLE];
    byName.forEach((table) => {
      expect(parseTableState(table, {})).toMatchObject({ sort: 'name', dir: 'asc' });
      expect(defined(table.sorts.name, 'the name sort').directions.asc).toBe('aToZ');
    });
    byDate.forEach((table) => {
      const { sort, dir } = parseTableState(table, {});
      expect(dir).toBe('desc');
      const definition = defined(table.sorts[sort], 'the default sort');
      expect(definition.directions.desc).toBe('newestFirst');
      expect(definition.directions.asc).toBe('oldestFirst');
    });
  });

  it('lists people the same way wherever they appear', () => {
    [USERS_TABLE, STAFF_TABLE, MEMBERS_TABLE].forEach((table) => {
      expect(table.prefix).toBe('');
      expect(Object.keys(table.sorts)).toEqual(['name', 'email', 'last-active', 'joined']);
      expect(table.sorts.name).toMatchObject({ label: 'name', first: 'asc' });
      expect(table.sorts.email).toMatchObject({ label: 'email', first: 'asc' });
      expect(table.sorts['last-active']).toEqual({
        label: 'lastActive',
        first: 'desc',
        directions: { desc: 'mostRecentFirst', asc: 'leastRecentFirst' },
      });
      expect(table.sorts.joined).toMatchObject({ label: 'joined', first: 'desc' });
    });
  });

  it('lists companies by their name or when they were added or joined', () => {
    expect(Object.keys(COMPANIES_TABLE.sorts)).toEqual(['name', 'added']);
    expect(COMPANIES_TABLE.sorts.name.label).toBe('company');
    expect(COMPANIES_TABLE.sorts.added).toMatchObject({ label: 'added', first: 'desc' });
    expect(Object.keys(USER_COMPANIES_TABLE.sorts)).toEqual(['name', 'joined']);
    expect(USER_COMPANIES_TABLE.sorts.name.label).toBe('company');
    expect(USER_COMPANIES_TABLE.sorts.joined).toMatchObject({ label: 'joined', first: 'desc' });
  });

  it('lists invitations by email or when they were sent, and links and devices by date', () => {
    expect(Object.keys(INVITATIONS_TABLE.sorts)).toEqual(['email', 'sent']);
    expect(INVITATIONS_TABLE.sorts.email).toMatchObject({ label: 'email', first: 'asc' });
    expect(INVITATIONS_TABLE.sorts.sent).toMatchObject({ label: 'sent', first: 'desc' });
    expect(Object.keys(INVITE_LINKS_TABLE.sorts)).toEqual(['created']);
    expect(INVITE_LINKS_TABLE.sorts.created).toMatchObject({ label: 'created', first: 'desc' });
    expect(Object.keys(DEVICES_TABLE.sorts)).toEqual(['signed-in']);
    expect(DEVICES_TABLE.sorts['signed-in']).toMatchObject({ label: 'signedIn', first: 'desc' });
  });

  it('gives the main table of a page no prefix and every other table its own', () => {
    [USERS_TABLE, STAFF_TABLE, MEMBERS_TABLE, COMPANIES_TABLE].forEach((table) => {
      expect(table.prefix).toBe('');
    });
    expect(USER_COMPANIES_TABLE.prefix).toBe('companies-');
    expect(INVITATIONS_TABLE.prefix).toBe('inv-');
    expect(INVITE_LINKS_TABLE.prefix).toBe('links-');
    expect(DEVICES_TABLE.prefix).toBe('devices-');
  });

  it.each<{ page: string; tables: TableDefinition[] }>([
    {
      page: "a company's members",
      tables: [MEMBERS_TABLE, INVITATIONS_TABLE, INVITE_LINKS_TABLE],
    },
    { page: 'the staff', tables: [STAFF_TABLE, INVITATIONS_TABLE, INVITE_LINKS_TABLE] },
    { page: "a user's page", tables: [USER_COMPANIES_TABLE, DEVICES_TABLE] },
  ])('keeps the tables on $page apart', ({ tables }) => {
    const prefixes = tables.map(({ prefix }) => prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    const names = paramNames(tables);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every table that is not a main table a prefix of its own', () => {
    const prefixes = [
      USER_COMPANIES_TABLE,
      INVITATIONS_TABLE,
      INVITE_LINKS_TABLE,
      DEVICES_TABLE,
    ].map(({ prefix }) => prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes).not.toContain('');
  });

  it("names the anchor of their card for the tables that aren't a page's main table", () => {
    expect(USER_COMPANIES_TABLE.section).toBe('companies');
    expect(INVITATIONS_TABLE.section).toBe('invitations');
    expect(INVITE_LINKS_TABLE.section).toBe('invite-links');
    expect(DEVICES_TABLE.section).toBe('devices');
    TABLES.forEach(({ table }) => {
      if (table.prefix === '') {
        expect(table.section).toBeUndefined();
      } else {
        expect(isSectionId(table.section)).toBe(true);
      }
    });
  });

  it('takes no parameter the pages use for their search or filter', () => {
    paramNames(TABLES.map(({ table }) => table)).forEach((name) => {
      expect(PAGE_PARAMS).not.toContain(name);
    });
  });

  it('reads the parameters of tables that share a page independently', () => {
    const params = {
      sort: 'email',
      page: '2',
      'inv-sort': 'email',
      'inv-dir': 'desc',
      'inv-page': '3',
      'links-page': '4',
      'devices-size': '50',
    };
    expect(parseTableState(MEMBERS_TABLE, params)).toEqual({
      sort: 'email',
      dir: 'asc',
      page: 2,
      size: 25,
    });
    expect(parseTableState(INVITATIONS_TABLE, params)).toEqual({
      sort: 'email',
      dir: 'desc',
      page: 3,
      size: 25,
    });
    expect(parseTableState(INVITE_LINKS_TABLE, params)).toEqual({
      sort: 'created',
      dir: 'desc',
      page: 4,
      size: 25,
    });
    expect(parseTableState(DEVICES_TABLE, params)).toEqual({
      sort: 'signed-in',
      dir: 'desc',
      page: 1,
      size: 50,
    });
    expect(parseTableState(USER_COMPANIES_TABLE, params)).toEqual({
      sort: 'name',
      dir: 'asc',
      page: 1,
      size: 25,
    });
  });
});
