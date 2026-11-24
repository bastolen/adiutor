/**
 * @file Keeps the titles of pages someone may not see in step with the
 * pages' checks: every page or layout under `src/app` that requires a
 * permission (`requireGlobalPermission`, or `requireCompanyAccess` with one)
 * exports its `generateMetadata` from `src/server/page-metadata.ts` with the
 * same permission, and no static `metadata`. People who get the 404 page then
 * get its title too ("Not found · Adiutor"), not the page's. Only the route
 * files themselves are read, so the check stays in them, not in a component
 * they import.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { defined } from '@/lib/defined';

import sourceFiles from '../../tests/source-files';

/** The repository root, so paths in messages read like `src/app/...`. */
const ROOT = path.resolve(import.meta.dirname, '../..');

/** A permission check in a route file, and the metadata helper that must go with it. */
interface CheckRule {
  /** Finds the permissions a file checks (the first group of each match). */
  check: RegExp;
  /** The helper from `src/server/page-metadata.ts` that gives the title the same check. */
  helper: string;
}

/** The permission checks of route files, and their metadata helpers. */
const RULES: CheckRule[] = [
  { check: /requireGlobalPermission\(\s*'([^']+)'/g, helper: 'globalPermissionMetadata' },
  { check: /requireCompanyAccess\(\s*[^,()]+,\s*'([^']+)'/g, helper: 'companyPermissionMetadata' },
];

/** A route file that requires a permission. */
interface GuardedRoute {
  /** Its path from the root. */
  file: string;
  /** Its source. */
  source: string;
  /** The metadata helper and permission each of its checks needs. */
  needs: { helper: string; permission: string }[];
}

/** Every page and layout under `src/app` that requires a permission. */
const guardedRoutes: GuardedRoute[] = sourceFiles(
  path.join(ROOT, 'src', 'app'),
  /^(?:page|layout)\.tsx?$/,
)
  .map((full) => {
    const source = readFileSync(full, 'utf8');
    const needs = RULES.flatMap(({ check, helper }) =>
      [...source.matchAll(check)].map(([, permission]) => ({
        helper,
        permission: defined(permission, 'the checked permission'),
      })),
    );
    return { file: path.relative(ROOT, full), source, needs };
  })
  .filter(({ needs }) => needs.length > 0);

describe('titles of pages someone may not see', () => {
  it('finds the pages that require a permission', () => {
    // The staff pages, the Logs and Settings layouts, and a company's Members and Settings pages.
    expect(guardedRoutes.length).toBeGreaterThanOrEqual(11);
  });

  it.each(guardedRoutes)('$file gives its title the same check', ({ source, needs }) => {
    expect(source, 'a static title would be shown with the 404 page').not.toMatch(
      /export const metadata\b/,
    );
    needs.forEach(({ helper, permission }) => {
      expect(source).toMatch(
        new RegExp(`export const generateMetadata = ${helper}\\(\\s*'${permission}'`),
      );
    });
  });
});
