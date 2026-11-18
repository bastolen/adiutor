/**
 * @file Tests for the app's table definitions: that their sorts can appear
 * in a URL, and that the query parameters and card anchors of tables that
 * share a page never collide.
 */
import { describe, expect, it } from 'vitest';

import { isSectionId } from '@/lib/redirect';

import { type TableDefinition } from './table-state';
import {
  AUDIT_LOG_TABLE,
  COMPANIES_TABLE,
  DEVICES_TABLE,
  ERRORS_TABLE,
  FAILED_JOBS_TABLE,
  INVITATIONS_TABLE,
  INVITE_LINKS_TABLE,
  JOB_RUNS_TABLE,
  MEMBERS_TABLE,
  REQUESTS_TABLE,
  STAFF_REQUESTS_TABLE,
  STAFF_TABLE,
  USER_COMPANIES_TABLE,
  USERS_TABLE,
} from './tables';

/** Every table, with its constant's name for the test's name. */
const TABLES: { name: string; table: TableDefinition }[] = [
  { name: 'USERS_TABLE', table: USERS_TABLE },
  { name: 'STAFF_TABLE', table: STAFF_TABLE },
  { name: 'MEMBERS_TABLE', table: MEMBERS_TABLE },
  { name: 'COMPANIES_TABLE', table: COMPANIES_TABLE },
  { name: 'USER_COMPANIES_TABLE', table: USER_COMPANIES_TABLE },
  { name: 'INVITATIONS_TABLE', table: INVITATIONS_TABLE },
  { name: 'INVITE_LINKS_TABLE', table: INVITE_LINKS_TABLE },
  { name: 'DEVICES_TABLE', table: DEVICES_TABLE },
  { name: 'AUDIT_LOG_TABLE', table: AUDIT_LOG_TABLE },
  { name: 'ERRORS_TABLE', table: ERRORS_TABLE },
  { name: 'REQUESTS_TABLE', table: REQUESTS_TABLE },
  { name: 'STAFF_REQUESTS_TABLE', table: STAFF_REQUESTS_TABLE },
  { name: 'JOB_RUNS_TABLE', table: JOB_RUNS_TABLE },
  { name: 'FAILED_JOBS_TABLE', table: FAILED_JOBS_TABLE },
];

/** The query parameters every table has, after its prefix. */
const TABLE_PARAMS = ['sort', 'dir', 'page', 'size'];

/**
 * The parameters pages use for themselves (search, filters, the audit log's
 * group and dates, a request list's status, company, type and priority),
 * which no table may take.
 */
const PAGE_PARAMS = ['q', 'filter', 'group', 'from', 'to', 'status', 'company', 'type', 'priority'];

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
  describe.each(TABLES)('$name', ({ table }) => {
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

  it.each<{ page: string; tables: TableDefinition[] }>([
    {
      page: "a company's members",
      tables: [MEMBERS_TABLE, INVITATIONS_TABLE, INVITE_LINKS_TABLE],
    },
    { page: 'the staff', tables: [STAFF_TABLE, INVITATIONS_TABLE, INVITE_LINKS_TABLE] },
    { page: "a user's page", tables: [USER_COMPANIES_TABLE, DEVICES_TABLE] },
    { page: 'the jobs page', tables: [JOB_RUNS_TABLE, FAILED_JOBS_TABLE] },
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
      FAILED_JOBS_TABLE,
    ].map(({ prefix }) => prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes).not.toContain('');
  });

  it("names the anchor of their card for the tables that aren't a page's main table", () => {
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
});
