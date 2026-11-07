/**
 * @file Tells the developer when the database is behind the migrations in
 * `drizzle/`. `src/instrumentation.ts` runs {@link checkMigrations} once when
 * `pnpm dev` starts, in the background; without it, a missing migration only
 * shows up as a page failing with `relation "…" does not exist`.
 *
 * drizzle-kit records each migration it applies in
 * `drizzle.__drizzle_migrations`, with the journal entry's `when` as
 * `created_at`, and `pnpm db:migrate` applies every journal entry newer than
 * the newest one recorded. {@link migrationStatus} uses that same rule, so
 * "pending" means exactly what `pnpm db:migrate` would apply, and it also
 * spots a database whose migrations came from other code, which
 * `pnpm db:migrate` can't fix.
 *
 * Nothing here imports the database client at load time, so unit tests load
 * it without a database.
 */
import { sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';

import journal from '../../drizzle/meta/_journal.json';

/** A migration in `drizzle/meta/_journal.json`. */
export interface JournalEntry {
  /** The migration's name, e.g. `0000_init` (its file is `drizzle/<tag>.sql`). */
  tag: string;
  /** When it was generated, in milliseconds; drizzle-kit records this as `created_at`. */
  when: number;
}

/** What `drizzle.__drizzle_migrations` says has been applied. */
export interface AppliedMigrations {
  /** How many migrations are recorded. */
  count: number;
  /** The newest recorded `created_at`, or `null` when none are recorded. */
  lastAppliedAt: number | null;
}

/**
 * How the database compares with the migrations in `drizzle/`:
 * - `current`: everything is applied;
 * - `pending`: the migrations named in `tags` (oldest first) still need
 *   `pnpm db:migrate`;
 * - `unmigrated`: none have been applied yet;
 * - `mismatch`: the recorded migrations aren't the ones in `drizzle/` (applied
 *   from another branch, before the migrations were regenerated, or a merged
 *   migration older than the newest applied one), which `pnpm db:migrate`
 *   can't fix.
 */
export type MigrationStatus =
  | { state: 'current' }
  | { state: 'pending'; tags: string[] }
  | { state: 'unmigrated' }
  | { state: 'mismatch' };

/** The migrations in `drizzle/`, oldest first, as this build knows them. */
export const JOURNAL_ENTRIES: readonly JournalEntry[] = journal.entries;

/**
 * Compares the migrations in `drizzle/` with those the database has applied.
 * An entry is pending when it's newer than the newest applied one, as
 * drizzle-kit decides. When the number of applied migrations differs from the
 * number of entries up to the newest applied one, they can't be the same
 * migrations, so the status is `mismatch`.
 *
 * @param entries - The journal's entries, oldest first.
 * @param applied - What the database has applied, or `null` when it has no
 *   migrations table.
 * @returns The status.
 */
export function migrationStatus(
  entries: readonly JournalEntry[],
  applied: AppliedMigrations | null,
): MigrationStatus {
  if (applied === null || applied.count === 0) {
    return entries.length > 0 ? { state: 'unmigrated' } : { state: 'current' };
  }
  const lastAppliedAt = applied.lastAppliedAt ?? Number.NEGATIVE_INFINITY;
  const upToLastApplied = entries.filter((entry) => entry.when <= lastAppliedAt);
  if (upToLastApplied.length !== applied.count) {
    return { state: 'mismatch' };
  }
  const tags = entries.filter((entry) => entry.when > lastAppliedAt).map((entry) => entry.tag);
  return tags.length > 0 ? { state: 'pending', tags } : { state: 'current' };
}

/**
 * The warning to log for a status.
 *
 * @param status - How the database compares with `drizzle/`.
 * @returns The warning, or `null` when the database is up to date.
 */
export function migrationWarning(status: MigrationStatus): string | null {
  switch (status.state) {
    case 'pending': {
      const count = status.tags.length;
      const migrations = count === 1 ? '1 migration' : `${count} migrations`;
      return (
        `The database is missing ${migrations} from drizzle/: ${status.tags.join(', ')}. ` +
        'Run `pnpm db:migrate`; pages that need them fail until then.'
      );
    }
    case 'unmigrated':
      return 'The database has no migrations applied yet. Run `pnpm db:migrate`.';
    case 'mismatch':
      return (
        "The database's migrations don't match drizzle/ (it was migrated from another branch, " +
        "or before the migrations were regenerated), so `pnpm db:migrate` can't fix it. " +
        'See "Starting over" in docs/development.md.'
      );
    default:
      return null;
  }
}

/**
 * Reads what drizzle-kit has recorded as applied, from the schema and table
 * it uses by default (`drizzle.config.ts` doesn't change them).
 *
 * @param db - The database.
 * @returns The applied migrations, or `null` when there's no migrations table.
 */
export async function readAppliedMigrations(
  db: DatabaseOrTransaction,
): Promise<AppliedMigrations | null> {
  const { rows: tables } = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as "exists"`,
  );
  if (!tables[0]?.exists) {
    return null;
  }
  // `created_at` is a bigint, which pg returns as a string; millisecond timestamps fit a number.
  const { rows } = await db.execute<{ count: number; lastAppliedAt: string | number | null }>(
    sql`select count(*)::int as "count", max(created_at) as "lastAppliedAt" from drizzle.__drizzle_migrations`,
  );
  const row = rows[0];
  if (!row || row.count === 0) {
    return { count: 0, lastAppliedAt: null };
  }
  return {
    count: row.count,
    lastAppliedAt: row.lastAppliedAt === null ? null : Number(row.lastAppliedAt),
  };
}

/**
 * Reads the applied migrations from the app's database, loading its client
 * only now.
 *
 * @returns The applied migrations, or `null` when there's no migrations table.
 */
async function readFromAppDatabase(): Promise<AppliedMigrations | null> {
  const { db } = await import('@/db');
  return readAppliedMigrations(db);
}

/**
 * Finds the code of an error (a Node.js code such as `ECONNREFUSED`, or a
 * Postgres SQL state), looking through its causes since Drizzle wraps the
 * driver's errors. Safe to log, unlike the message, which could hold
 * connection details. Also used by the health check (`src/server/health.ts`).
 *
 * @param error - The thrown value.
 * @param depth - How many causes deep this is.
 * @returns The code, or `null` when there's none.
 */
export function errorCode(error: unknown, depth = 0): string | null {
  if (typeof error !== 'object' || error === null || depth > 3) {
    return null;
  }
  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'cause' in error ? errorCode(error.cause, depth + 1) : null;
}

/**
 * Logs a warning when the database is missing migrations from `drizzle/`,
 * has none, or has migrations that don't match them; logs nothing when it's
 * up to date. Never throws: when the database can't be read (e.g. it's
 * down), it logs a short note with only the error's code, since the message
 * could hold connection details.
 *
 * @param readApplied - Reads the applied migrations (the app's database by
 *   default).
 * @param entries - The migrations in `drizzle/` (this build's journal by
 *   default).
 * @returns Nothing, once it has logged.
 */
export async function checkMigrations(
  readApplied: () => Promise<AppliedMigrations | null> = readFromAppDatabase,
  entries: readonly JournalEntry[] = JOURNAL_ENTRIES,
): Promise<void> {
  let applied: AppliedMigrations | null;
  try {
    applied = await readApplied();
  } catch (error) {
    const code = errorCode(error);
    // eslint-disable-next-line no-console -- Tells the developer at startup; the code only, never the message.
    console.warn(`Couldn't check the database for pending migrations${code ? ` (${code})` : ''}.`);
    return;
  }
  const warning = migrationWarning(migrationStatus(entries, applied));
  if (warning) {
    // eslint-disable-next-line no-console -- Tells the developer at startup; names migrations only.
    console.warn(warning);
  }
}
