/**
 * @file Vitest global setup for integration tests: prepares the test database
 * once and shares its URL with the test files.
 */
import type { TestProject } from 'vitest/node';

import getTestDatabaseUrl from '../database/database-url';
import prepareTestDatabase from '../database/prepare-database';

declare module 'vitest' {
  /** Values shared from the global setup with test files via `inject()`. */
  export interface ProvidedContext {
    /** Connection string of the migrated test database. */
    databaseUrl: string;
  }
}

/**
 * Creates and migrates the test database, then shares its URL.
 *
 * @param project - The Vitest project being set up.
 */
export default async function setup(project: TestProject): Promise<void> {
  const databaseUrl = getTestDatabaseUrl();
  await prepareTestDatabase(databaseUrl);
  project.provide('databaseUrl', databaseUrl);
}
