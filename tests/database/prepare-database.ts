/**
 * @file Creates the test database if it doesn't exist, then applies all
 * migrations to it. Shared by the integration test setup
 * (`tests/integration/global-setup.ts`) and the end-to-end one
 * (`e2e/support/global-setup.ts`).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

/**
 * Makes sure the test database exists and is fully migrated.
 *
 * @param databaseUrl - Connection string of the test database.
 */
export default async function prepareTestDatabase(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`Unexpected test database name: ${name}`);
  }

  // Connect to the server's default database to create the test database.
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) {
      await admin.query(`create database "${name}"`);
    }
  } finally {
    await admin.end();
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
  } finally {
    await client.end();
  }
}
