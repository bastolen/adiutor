/**
 * @file Playwright global setup: prepares and seeds the test database, and
 * empties the email outbox and the attached files' folder before the tests
 * run.
 */
import { mkdir, rm } from 'node:fs/promises';

import getTestDatabaseUrl from '../../tests/database/database-url';
import prepareTestDatabase from '../../tests/database/prepare-database';
import { ATTACHMENTS_DIR, OUTBOX_DIR } from './fixtures';
import seedTestDatabase from './seed';

/**
 * Migrates and seeds the test database, and clears old emails and files.
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = getTestDatabaseUrl();
  await prepareTestDatabase(databaseUrl);
  await seedTestDatabase();
  await rm(OUTBOX_DIR, { recursive: true, force: true });
  // The storage's folder must exist; the seeded database has no files in it.
  await rm(ATTACHMENTS_DIR, { recursive: true, force: true });
  await mkdir(ATTACHMENTS_DIR, { recursive: true });
}
