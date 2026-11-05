/**
 * @file Database client: Drizzle ORM on a PostgreSQL connection pool.
 *
 * Imported by `src/lib/auth.ts`, so it uses relative imports and no
 * `server-only` (the Better Auth CLI must be able to load it).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';
import { env } from '../lib/env';

/**
 * Creates a Drizzle client for a database.
 *
 * @param connectionString - PostgreSQL connection string.
 * @returns The client, with its connection pool as `$client`.
 */
export function createDatabase(connectionString: string) {
  return drizzle(new Pool({ connectionString }), { schema });
}

/** A Drizzle client for this app's schema. */
export type Database = ReturnType<typeof createDatabase>;

/**
 * An open transaction, for work that must run inside one (e.g. taking a
 * transaction-scoped lock).
 */
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** A database client or an open transaction; services accept either. */
export type DatabaseOrTransaction = Database | DatabaseTransaction;

/** The app's database client. */
export const db = createDatabase(env.DATABASE_URL);
