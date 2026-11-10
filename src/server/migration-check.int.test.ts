/**
 * @file Integration test for reading what drizzle-kit has applied: the test
 * database is migrated from `drizzle/` before the run, so it records every
 * journal entry and the startup check finds nothing to warn about.
 */
import { describe, expect, it } from 'vitest';

import { setupTestContext } from '../../tests/integration/helpers';
import { JOURNAL_ENTRIES, migrationStatus, readAppliedMigrations } from './migration-check';

const { db } = setupTestContext();

describe('readAppliedMigrations', () => {
  it('reads one recorded migration per journal entry, up to the newest', async () => {
    const applied = await readAppliedMigrations(db);

    expect(applied).toEqual({
      count: JOURNAL_ENTRIES.length,
      lastAppliedAt: JOURNAL_ENTRIES.at(-1)?.when,
    });
    expect(migrationStatus(JOURNAL_ENTRIES, applied)).toEqual({ state: 'current' });
  });
});
