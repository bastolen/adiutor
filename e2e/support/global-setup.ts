/**
 * @file Playwright global setup: prepares and seeds the test database and
 * empties the email outbox before the tests run.
 */
import { rm } from 'node:fs/promises';

import getTestDatabaseUrl from '../../tests/database/database-url';
import prepareTestDatabase from '../../tests/database/prepare-database';
import { OUTBOX_DIR } from './fixtures';
import seedTestDatabase from './seed';

/**
 * Migrates and seeds the test database, and clears old emails.
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = getTestDatabaseUrl();
  await prepareTestDatabase(databaseUrl);
  await seedTestDatabase(databaseUrl);
  await rm(OUTBOX_DIR, { recursive: true, force: true });
}
