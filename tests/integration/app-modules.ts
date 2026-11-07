/**
 * @file Stand-in for the app's database module (`@/db`) in integration tests
 * of code that imports its client directly, such as the Better Auth hooks:
 *
 * ```ts
 * vi.mock('@/db', async (importOriginal) =>
 *   (await import('../../../tests/integration/app-modules')).default(await importOriginal()),
 * );
 * ```
 */
import { inject } from 'vitest';

import type * as Db from '@/db';

/**
 * Builds a `@/db` module whose client uses the test database.
 *
 * @param actual - The real module.
 * @returns The module's exports.
 */
export default function testDatabaseModule(actual: typeof Db): typeof Db {
  return { ...actual, db: actual.createDatabase(inject('databaseUrl')) };
}
