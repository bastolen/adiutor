/**
 * @file The one way to empty the database, shared by the integration tests
 * (before each test), the end-to-end seed (`e2e/support/seed.ts`) and the
 * development seed (`scripts/seed-dev.ts`), so a table is never missed in one
 * of them.
 *
 * It deletes rows rather than truncating tables. `TRUNCATE` gives every table
 * and index it empties new files, and PostgreSQL removes the old ones only at
 * the next checkpoint: before each of the thousand-odd integration tests, that
 * piled up over a hundred thousand files, which a database on a Docker bind
 * mount (local development on macOS) syncs and deletes slowly, and after which
 * dropping the database could hang. `DELETE` writes into the files the tables
 * already have, and with a handful of rows per table it is quicker too (about
 * 2 ms against 220 ms on that mount).
 */
import { is, type SQL, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

import * as schema from '../../src/db/schema';

/**
 * Anything that runs a SQL statement: a Drizzle database client, or the open
 * transaction of one (the development seed empties the database inside its
 * transaction).
 */
export interface SqlExecutor {
  /**
   * Runs a SQL statement.
   *
   * @param query - The statement.
   * @returns Resolves when the statement is done.
   */
  execute: (query: SQL) => PromiseLike<unknown>;
}

/**
 * Orders tables so that each comes after every table it references (through
 * its foreign keys), by visiting those first.
 *
 * @param tables - The tables, in any order.
 * @returns The same tables, the referenced ones first.
 */
function referencedFirst(tables: readonly PgTable[]): PgTable[] {
  const ordered: PgTable[] = [];
  const visited = new Set<PgTable>();
  /**
   * Places a table after the tables it references.
   *
   * @param table - The table.
   */
  const visit = (table: PgTable): void => {
    if (visited.has(table)) {
      return;
    }
    visited.add(table);
    getTableConfig(table).foreignKeys.forEach((foreignKey) => {
      visit(foreignKey.reference().foreignTable);
    });
    ordered.push(table);
  };
  tables.forEach(visit);
  return ordered;
}

/**
 * Every table in the Drizzle schema (which every migration is generated
 * from), each before the tables it references. Deleting in this order never
 * leaves a row pointing at a deleted one, so no foreign key has to cascade or
 * set null, and a key that restricts deletes works too.
 */
const TABLES_REFERENCING_FIRST = referencedFirst(
  Object.values<unknown>(schema).filter((value): value is PgTable => is(value, PgTable)),
).reverse();

/**
 * Deletes every row of every table, in one statement: a `DO` block is a
 * single statement however the driver sends it, so it takes one round trip
 * and happens all at once or not at all.
 */
const DELETE_EVERY_ROW = sql`do $$ begin ${sql.join(
  TABLES_REFERENCING_FIRST.map((table) => sql`delete from ${table};`),
  sql` `,
)} end $$`;

/**
 * Empties the database as on a fresh install: every table in the schema,
 * including users, companies, the staff settings, rate limits, jobs and the
 * request counter. A new table is emptied too, since the tables come from the
 * schema. Nothing needs restarting: no ID or default comes from a sequence
 * (`src/db/schema.int.test.ts` checks it), and the request numbers come from
 * `request_counter` rows, which go with the rest.
 *
 * @param executor - The database client, or a transaction.
 */
export default async function emptyDatabase(executor: SqlExecutor): Promise<void> {
  await executor.execute(DELETE_EVERY_ROW);
}
