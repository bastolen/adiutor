/**
 * @file Tests for the app's table definitions: that their sorts can appear
 * in a URL, that the query parameters of tables that share a page never
 * collide, and that no two cards have the same anchor anywhere in the app,
 * whether it's a table's section or a `Card`'s fixed `id` in the source.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isSectionId } from '@/lib/redirect';

import { type TableDefinition } from './table-state';
import {
  COMPANY_INVITATIONS_TABLE,
  COMPANY_INVITE_LINKS_TABLE,
  DEVICES_TABLE,
  FAILED_JOBS_TABLE,
  INVITATIONS_TABLE,
  INVITE_LINKS_TABLE,
  JOB_RUNS_TABLE,
  MEMBERS_TABLE,
  STAFF_TABLE,
  USER_COMPANIES_TABLE,
  USER_DEVICES_TABLE,
} from './tables';
import * as tableModule from './tables';

/**
 * Every table `tables.ts` exports (its `*_TABLE` constants), with the
 * constant's name for the test's name, so a new table is covered as soon as
 * it's exported.
 */
const TABLES: { name: string; table: TableDefinition }[] = Object.entries(tableModule)
  .filter(([name]) => name.endsWith('_TABLE'))
  .map(([name, table]) => ({ name, table }));

/** The repository root, so paths in messages read like `src/app/...`. */
const ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * Lists the TypeScript files below a folder, tests left out.
 *
 * @param dir - The folder.
 * @returns Their absolute paths.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * A file's source without its comments (block and JSX comments, and lines
 * that are a `//` comment), so an example in a comment isn't read as code.
 *
 * @param source - The file's source.
 * @returns The source without them.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The opening tags of an element in a file's source, e.g. every `<Card ...>`,
 * read up to the `>` that closes the tag (one inside braces, such as an
 * arrow function's, doesn't).
 *
 * @param source - The file's source.
 * @param element - The element's name.
 * @returns Each opening tag's text.
 */
function openingTags(source: string, element: string): string[] {
  const tags: string[] = [];
  const start = new RegExp(`<${element}\\b`, 'g');
  for (let match = start.exec(source); match; match = start.exec(source)) {
    let depth = 0;
    let end = match.index;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
      } else if (char === '>' && depth === 0) {
        break;
      }
    }
    tags.push(source.slice(match.index, end));
  }
  return tags;
}

/**
 * The fixed anchors of the cards in the app's source: each `Card`'s `id`
 * that's a string (`id="invite"`) or a constant (`id={SECTION}`, looked up
 * where the file or another one declares it as a string), with the files
 * that use it. An `id` taken from a table (`id={table.section}`) is a
 * table's section, which {@link TABLES} covers.
 *
 * @returns The files of each anchor, by anchor.
 */
function fixedCardAnchors(): Map<string, Set<string>> {
  const files = ['src/app', 'src/components'].flatMap((dir) => sourceFiles(path.join(ROOT, dir)));
  const sources = new Map(files.map((file) => [file, withoutComments(readFileSync(file, 'utf8'))]));
  const everySource = [...sources.values()].join('\n');
  const libSources = sourceFiles(path.join(ROOT, 'src/lib'))
    .map((file) => withoutComments(readFileSync(file, 'utf8')))
    .join('\n');
  /**
   * Looks a constant up where it's declared as a string.
   *
   * @param name - The constant, e.g. `SECTION`.
   * @param source - The file that uses it, looked in first.
   * @returns Its value.
   */
  const constantValue = (name: string, source: string): string => {
    const declared = new RegExp(`const ${name} = '([^']+)'`);
    const found = [source, everySource, libSources]
      .map((text) => declared.exec(text)?.[1])
      .find((value) => value !== undefined);
    if (found === undefined) {
      throw new Error(`A card's id is the constant ${name}, which isn't declared as a string.`);
    }
    return found;
  };
  const anchors = new Map<string, Set<string>>();
  sources.forEach((source, file) => {
    openingTags(source, 'Card').forEach((tag) => {
      const literal = /\bid="([^"]+)"/.exec(tag)?.[1];
      const constant = /\bid=\{([A-Z][A-Z0-9_]*)\}/.exec(tag)?.[1];
      let anchor = literal;
      if (anchor === undefined && constant !== undefined) {
        anchor = constantValue(constant, source);
      }
      if (anchor !== undefined) {
        const users = anchors.get(anchor) ?? new Set<string>();
        users.add(path.relative(ROOT, file));
        anchors.set(anchor, users);
      }
    });
  });
  return anchors;
}

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
      tables: [MEMBERS_TABLE, COMPANY_INVITATIONS_TABLE, COMPANY_INVITE_LINKS_TABLE],
    },
    { page: 'the staff', tables: [STAFF_TABLE, INVITATIONS_TABLE, INVITE_LINKS_TABLE] },
    { page: "a user's page", tables: [USER_COMPANIES_TABLE, USER_DEVICES_TABLE] },
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

  it('gives every card an anchor no other card has, since pages kept alive share the document', () => {
    const sections = TABLES.flatMap(({ table }) => (table.section ? [table.section] : []));
    expect(new Set(sections).size).toBe(sections.length);

    // The cards with a fixed id: one file each (a card a page renders in one of two branches
    // counts once), never a table's section, and each a section ID.
    const fixed = fixedCardAnchors();
    // The scan finds the cards: here the company's invite card, a string on its page.
    expect(fixed.get('company-invite')).toEqual(
      new Set(['src/app/(app)/companies/[companyId]/members/page.tsx']),
    );
    fixed.forEach((files, anchor) => {
      expect(isSectionId(anchor), anchor).toBe(true);
      expect([...files], `the cards with the anchor ${anchor}`).toHaveLength(1);
      expect(sections, `the card with the anchor ${anchor}`).not.toContain(anchor);
    });
  });

  it.each([
    ['COMPANY_INVITATIONS_TABLE', COMPANY_INVITATIONS_TABLE, INVITATIONS_TABLE],
    ['COMPANY_INVITE_LINKS_TABLE', COMPANY_INVITE_LINKS_TABLE, INVITE_LINKS_TABLE],
    ['USER_DEVICES_TABLE', USER_DEVICES_TABLE, DEVICES_TABLE],
  ])('keeps the address parameters and sorts of the table %s copies', (_name, copy, original) => {
    expect({ ...copy, section: undefined }).toEqual({ ...original, section: undefined });
  });

  it('takes no parameter the pages use for their search or filter', () => {
    paramNames(TABLES.map(({ table }) => table)).forEach((name) => {
      expect(PAGE_PARAMS).not.toContain(name);
    });
  });
});
