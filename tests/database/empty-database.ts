/**
 * @file The one way to empty the database, shared by the integration tests
 * (before each test), the end-to-end seed (`e2e/support/seed.ts`) and the
 * development seed (`scripts/seed-dev.ts`), so a table is never missed in one
 * of them.
 */
import { type SQL, sql } from 'drizzle-orm';

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
 * Empties the database as on a fresh install: every user, company, the staff
 * settings, verification tokens and rate limits, and (through `cascade`)
 * everything that belongs to them.
 *
 * A new table that `cascade` from `user` or `company` doesn't reach (one with
 * no foreign key to either) must be added to the statement here, or the tests
 * and the seeds start leaving its rows behind.
 *
 * @param executor - The database client, or a transaction.
 */
export default async function emptyDatabase(executor: SqlExecutor): Promise<void> {
  await executor.execute(
    sql`truncate table "user", company, staff_settings, verification, rate_limit_bucket, rate_limit, job_state, job_run cascade`,
  );
}
