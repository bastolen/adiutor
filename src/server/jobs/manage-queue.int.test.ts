/**
 * @file Integration tests for looking after the queue, against the test
 * database: counting waiting and failed jobs per kind, listing the failed
 * ones, and retrying or discarding them by ID or by kind.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { jobState, queuedJob } from '@/db/schema';

import { setupTestContext, storeQueuedJob } from '../../../tests/integration/helpers';
import {
  discardFailedQueuedJobs,
  listFailedQueuedJobs,
  listQueuedKinds,
  retryFailedQueuedJobs,
} from './manage-queue';

const { db } = setupTestContext();

/**
 * The stored jobs.
 *
 * @returns Each job's ID, kind, status and attempts, in the order they were added.
 */
async function stored() {
  return db
    .select({
      id: queuedJob.id,
      kind: queuedJob.kind,
      status: queuedJob.status,
      attempts: queuedJob.attempts,
    })
    .from(queuedJob)
    .orderBy(asc(queuedJob.id));
}

describe('listQueuedKinds', () => {
  it('counts waiting and failed jobs per kind, including kinds no longer registered', async () => {
    await storeQueuedJob(db, 'adiutor-tests-gone', 'queued');
    await storeQueuedJob(db, 'adiutor-tests-gone', 'running');
    await storeQueuedJob(db, 'adiutor-tests-gone', 'failed');
    await storeQueuedJob(db, 'adiutor-tests-gone', 'succeeded');
    await db.insert(jobState).values({ name: 'adiutor-tests-gone', pausedAt: sql`now()` });

    // A kind the registry no longer lists can't be paused, so a pause left behind doesn't count.
    expect(await listQueuedKinds(db)).toContainEqual({
      name: 'adiutor-tests-gone',
      known: false,
      pausable: false,
      paused: false,
      waiting: 2,
      failed: 1,
    });
  });
});

describe('listFailedQueuedJobs', () => {
  it('lists only the jobs that were given up', async () => {
    const failed = await storeQueuedJob(db, 'adiutor-tests-a', 'failed');
    await storeQueuedJob(db, 'adiutor-tests-a', 'queued');

    expect(await listFailedQueuedJobs(db)).toEqual([
      expect.objectContaining({ id: failed, kind: 'adiutor-tests-a', known: false, attempts: 5 }),
    ]);
  });
});

describe('retryFailedQueuedJobs', () => {
  it('puts a failed job back in the queue, with a fresh count of attempts', async () => {
    const failed = await storeQueuedJob(db, 'adiutor-tests-a', 'failed');
    const other = await storeQueuedJob(db, 'adiutor-tests-a', 'failed');

    await expect(retryFailedQueuedJobs(db, { id: failed })).resolves.toHaveLength(1);

    expect(await stored()).toEqual([
      { id: failed, kind: 'adiutor-tests-a', status: 'queued', attempts: 0 },
      { id: other, kind: 'adiutor-tests-a', status: 'failed', attempts: 5 },
    ]);
    const [retried] = await db
      .select({ finishedAt: queuedJob.finishedAt, due: sql<boolean>`${queuedJob.runAt} <= now()` })
      .from(queuedJob)
      .where(eq(queuedJob.id, failed));
    expect(retried).toEqual({ finishedAt: null, due: true });
  });

  it('puts back every failed job of a kind, and leaves the others alone', async () => {
    await storeQueuedJob(db, 'adiutor-tests-a', 'failed');
    await storeQueuedJob(db, 'adiutor-tests-a', 'failed');
    await storeQueuedJob(db, 'adiutor-tests-a', 'succeeded');
    await storeQueuedJob(db, 'adiutor-tests-b', 'failed');

    await expect(retryFailedQueuedJobs(db, { kind: 'adiutor-tests-a' })).resolves.toHaveLength(2);

    expect((await stored()).map(({ kind, status }) => `${kind}:${status}`)).toEqual([
      'adiutor-tests-a:queued',
      'adiutor-tests-a:queued',
      'adiutor-tests-a:succeeded',
      'adiutor-tests-b:failed',
    ]);
  });
});

describe('discardFailedQueuedJobs', () => {
  it('discards failed jobs only', async () => {
    const failed = await storeQueuedJob(db, 'adiutor-tests-a', 'failed');
    const waiting = await storeQueuedJob(db, 'adiutor-tests-a', 'queued');

    await expect(discardFailedQueuedJobs(db, { kind: 'adiutor-tests-a' })).resolves.toHaveLength(1);
    await expect(discardFailedQueuedJobs(db, { id: waiting })).resolves.toEqual([]);

    expect(await stored()).toEqual([
      { id: failed, kind: 'adiutor-tests-a', status: 'discarded', attempts: 5 },
      { id: waiting, kind: 'adiutor-tests-a', status: 'queued', attempts: 0 },
    ]);
  });
});
