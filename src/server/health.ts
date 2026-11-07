/**
 * @file The health check behind `/api/health`, for load balancers, container
 * platforms and uptime monitors: the app counts as healthy when its database
 * answers and has every migration in `drizzle/` applied, so a server that was
 * started before `pnpm db:migrate` reports itself unavailable instead of
 * failing on pages. It uses the same comparison as the startup warning in
 * development (`src/server/migration-check.ts`).
 *
 * It answers only healthy or not. When it isn't, it logs the reason without
 * personal data or connection details: the migration state, or an error's
 * code.
 */
import type { DatabaseOrTransaction } from '@/db';

import {
  errorCode,
  JOURNAL_ENTRIES,
  type JournalEntry,
  migrationStatus,
  readAppliedMigrations,
} from './migration-check';

/**
 * Checks whether the app can serve its pages: the database answers and is
 * up to date with the migrations in `drizzle/`. Never throws.
 *
 * @param db - The database.
 * @param entries - The migrations in `drizzle/` (this build's journal by
 *   default).
 * @returns Whether the app is healthy.
 */
export async function isHealthy(
  db: DatabaseOrTransaction,
  entries: readonly JournalEntry[] = JOURNAL_ENTRIES,
): Promise<boolean> {
  try {
    const status = migrationStatus(entries, await readAppliedMigrations(db));
    if (status.state === 'current') {
      return true;
    }
    // eslint-disable-next-line no-console -- Tells the operator why; the state only, no migration names.
    console.warn(`Health check: the database's migrations are ${status.state}.`);
    return false;
  } catch (error) {
    const code = errorCode(error);
    // eslint-disable-next-line no-console -- Tells the operator why; the code only, never the message.
    console.warn(`Health check: couldn't read the database${code ? ` (${code})` : ''}.`);
    return false;
  }
}
