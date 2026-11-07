/**
 * @file Tests for the startup check that tells the developer when the
 * database is behind `drizzle/`: which migrations are pending (as
 * drizzle-kit decides), when the applied ones can't be the same migrations,
 * the warning for each case, and that the check logs instead of throwing.
 * Reading the real migrations table is covered by
 * `migration-check.int.test.ts`.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type AppliedMigrations,
  checkMigrations,
  type JournalEntry,
  migrationStatus,
  migrationWarning,
} from './migration-check';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A journal of four migrations, oldest first. */
const entries: JournalEntry[] = [
  { tag: '0000_init', when: 1000 },
  { tag: '0001_account_confirmed', when: 2000 },
  { tag: '0002_app_error', when: 3000 },
  { tag: '0003_audit_activity_indexes', when: 4000 },
];

/**
 * What the database records after applying the journal's first migrations.
 *
 * @param count - How many of {@link entries} were applied.
 * @returns The applied migrations.
 */
const appliedFirst = (count: number): AppliedMigrations => ({
  count,
  lastAppliedAt: entries[count - 1]?.when ?? null,
});

/**
 * Replaces `console.warn` with a spy that records what's logged.
 *
 * @returns The spy.
 */
const spyOnWarnings = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

describe('migrationStatus', () => {
  it('is current when every migration is applied', () => {
    expect(migrationStatus(entries, appliedFirst(4))).toEqual({ state: 'current' });
  });

  it('names the migrations newer than the newest applied one, oldest first', () => {
    expect(migrationStatus(entries, appliedFirst(2))).toEqual({
      state: 'pending',
      tags: ['0002_app_error', '0003_audit_activity_indexes'],
    });
    expect(migrationStatus(entries, appliedFirst(3))).toEqual({
      state: 'pending',
      tags: ['0003_audit_activity_indexes'],
    });
  });

  it('is unmigrated without a migrations table, or with an empty one', () => {
    expect(migrationStatus(entries, null)).toEqual({ state: 'unmigrated' });
    expect(migrationStatus(entries, { count: 0, lastAppliedAt: null })).toEqual({
      state: 'unmigrated',
    });
  });

  it('is current when there are no migrations at all', () => {
    expect(migrationStatus([], null)).toEqual({ state: 'current' });
  });

  it('is a mismatch when the migrations were regenerated after the database was migrated', () => {
    expect(migrationStatus(entries, { count: 6, lastAppliedAt: 500 })).toEqual({
      state: 'mismatch',
    });
  });

  it('is a mismatch when the database has a migration newer than the journal knows', () => {
    expect(migrationStatus(entries, { count: 5, lastAppliedAt: 5000 })).toEqual({
      state: 'mismatch',
    });
    expect(migrationStatus([], { count: 1, lastAppliedAt: 1000 })).toEqual({ state: 'mismatch' });
  });

  it('is a mismatch when a migration older than the newest applied one was never applied', () => {
    // E.g. a branch merged in a migration generated before one already applied here.
    expect(migrationStatus(entries, { count: 3, lastAppliedAt: 4000 })).toEqual({
      state: 'mismatch',
    });
  });

  it('is a mismatch when migrations are recorded without a time', () => {
    expect(migrationStatus(entries, { count: 2, lastAppliedAt: null })).toEqual({
      state: 'mismatch',
    });
  });
});

describe('migrationWarning', () => {
  it('names the pending migrations and says to run `pnpm db:migrate`', () => {
    expect(
      migrationWarning({
        state: 'pending',
        tags: ['0006_app_error', '0007_audit_activity_indexes'],
      }),
    ).toBe(
      'The database is missing 2 migrations from drizzle/: 0006_app_error, ' +
        '0007_audit_activity_indexes. Run `pnpm db:migrate`; pages that need them fail until then.',
    );
  });

  it('counts a single pending migration in the singular', () => {
    expect(migrationWarning({ state: 'pending', tags: ['0006_app_error'] })).toContain(
      'missing 1 migration from drizzle/: 0006_app_error.',
    );
  });

  it('says to run `pnpm db:migrate` when nothing is applied yet', () => {
    expect(migrationWarning({ state: 'unmigrated' })).toBe(
      'The database has no migrations applied yet. Run `pnpm db:migrate`.',
    );
  });

  it("says `pnpm db:migrate` can't fix a mismatch and points at starting over", () => {
    const warning = migrationWarning({ state: 'mismatch' });

    expect(warning).toContain("`pnpm db:migrate` can't fix it");
    expect(warning).toContain('"Starting over" in docs/development.md');
  });

  it('says nothing when the database is up to date', () => {
    expect(migrationWarning({ state: 'current' })).toBeNull();
  });
});

describe('checkMigrations', () => {
  it('warns about the pending migrations', async () => {
    const warn = spyOnWarnings();

    await checkMigrations(async () => appliedFirst(2), entries);

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      migrationWarning({
        state: 'pending',
        tags: ['0002_app_error', '0003_audit_activity_indexes'],
      }),
    );
  });

  it('logs nothing when the database is up to date', async () => {
    const warn = spyOnWarnings();

    await checkMigrations(async () => appliedFirst(4), entries);

    expect(warn).not.toHaveBeenCalled();
  });

  it("logs a short note with only the error's code when the database can't be read", async () => {
    const warn = spyOnWarnings();
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });
    const failedQuery = new Error('Failed query: select … \nparams: jane@adiutor.test', {
      cause: refused,
    });

    await expect(
      checkMigrations(async () => Promise.reject(failedQuery), entries),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Couldn't check the database for pending migrations (ECONNREFUSED).",
    );
  });

  it("leaves the code out when the error has none, and never repeats the error's message", async () => {
    const warn = spyOnWarnings();

    await expect(
      checkMigrations(
        async () => Promise.reject(new Error('DATABASE_URL: jane@adiutor.test')),
        entries,
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Couldn't check the database for pending migrations.",
    );
  });

  it('checks against the journal in drizzle/ by default', async () => {
    const warn = spyOnWarnings();

    await checkMigrations(async () => null);

    expect(warn).toHaveBeenCalledExactlyOnceWith(migrationWarning({ state: 'unmigrated' }));
  });
});
