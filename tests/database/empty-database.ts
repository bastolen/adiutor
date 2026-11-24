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
 * The request types a fresh install has: the four that were built in, as the
 * migration that made types a table adds them before setup (in English, with
 * the keys and starting priorities they always had). Requests need a type
 * that exists, so emptying the database puts these back.
 */
const BUILT_IN_REQUEST_TYPES = [
  {
    key: 'hotfix',
    name: 'Hotfix',
    description: 'Something is broken and needs fixing right away.',
    startingPriority: 'high',
  },
  {
    key: 'bug',
    name: 'Bug',
    description: 'Something doesn’t work as it should.',
    startingPriority: 'normal',
  },
  {
    key: 'support',
    name: 'Support',
    description: 'A question, or help with something.',
    startingPriority: 'normal',
  },
  {
    key: 'new_feature',
    name: 'New feature',
    description: 'Something new, or a change to how things work.',
    startingPriority: 'low',
  },
] as const;

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
 * Deletes every row of every table, then adds the built-in request types
 * again, in one statement: a `DO` block is a single statement however the
 * driver sends it, so it takes one round trip and happens all at once or not
 * at all.
 */
const DELETE_EVERY_ROW = sql`do $$ begin ${sql.join(
  TABLES_REFERENCING_FIRST.map((table) => sql`delete from ${table};`),
  sql` `,
)} insert into ${schema.requestType} (key, name, description, starting_priority, position) values ${sql.raw(
  BUILT_IN_REQUEST_TYPES.map(
    ({ key, name, description, startingPriority }, index) =>
      `('${key}', '${name}', '${description}', '${startingPriority}', ${index + 1})`,
  ).join(', '),
)}; end $$`;

/**
 * Empties the database as on a fresh install: every table in the schema,
 * including users, companies, the settings (the staff's, setup, the request
 * counter and the last tick), rate limits and jobs, and leaves the built-in
 * request types (`BUILT_IN_REQUEST_TYPES`), which a fresh install has. A new
 * table is emptied too, since the tables come from the schema. Nothing needs
 * restarting: no ID or default comes from a sequence
 * (`src/db/schema.int.test.ts` checks it), and the request numbers come from
 * the `requests.last_number` setting, which goes with the rest.
 *
 * @param executor - The database client, or a transaction.
 */
export default async function emptyDatabase(executor: SqlExecutor): Promise<void> {
  await executor.execute(DELETE_EVERY_ROW);
}
