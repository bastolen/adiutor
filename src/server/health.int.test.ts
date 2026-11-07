/**
 * @file Integration tests for the health check: healthy against the test
 * database (migrated from `drizzle/` before the run), and unavailable when a
 * migration is missing or the database can't be read, logging only the state
 * or an error's code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseOrTransaction } from '@/db';

import { isHealthy } from './health';
import { JOURNAL_ENTRIES } from './migration-check';
import { setupTestContext } from '../../tests/integration/helpers';

const { db } = setupTestContext();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isHealthy', () => {
  it('is healthy when the database has every migration applied', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(isHealthy(db)).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is unavailable when a migration is missing, naming only the state', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const newest = JOURNAL_ENTRIES.at(-1)?.when ?? 0;
    const entries = [...JOURNAL_ENTRIES, { tag: '9999_adiutor_tests_next', when: newest + 1 }];

    await expect(isHealthy(db, entries)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith("Health check: the database's migrations are pending.");
  });

  it("is unavailable when the database can't be read, logging only the error's code", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = Object.assign(
      new Error('connect ECONNREFUSED postgresql://adiutor:secret@db.adiutor.test'),
      { code: 'ECONNREFUSED' },
    );
    const down = {
      /**
       * A query on a database that can't be reached.
       *
       * @returns A rejected promise, like the driver's.
       */
      execute: () => Promise.reject(failure),
    } as unknown as DatabaseOrTransaction;

    await expect(isHealthy(down)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith("Health check: couldn't read the database (ECONNREFUSED).");
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secret');
  });
});
