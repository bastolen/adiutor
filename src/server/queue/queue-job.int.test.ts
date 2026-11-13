/**
 * @file Integration tests for declaring a kind of queued job and queuing jobs
 * of it, against the test database: the payload is checked, a batched kind's
 * jobs get their batch key, and a kind reads only its own jobs.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';

import { queuedJob } from '@/db/schema';

import { setupTestContext } from '../../../tests/integration/helpers';
import { defineQueuedKind } from './define';
import { queueJob } from './queue-job';

const { db } = setupTestContext();

/** A kind whose jobs run on their own. */
const note = defineQueuedKind({
  name: 'adiutor-tests-note',
  payload: z.object({ userId: z.uuid(), note: z.string() }),
});

/** A kind whose jobs run in batches, per ticket and person. */
const commented = defineQueuedKind({
  name: 'adiutor-tests-commented',
  payload: z.object({ ticketId: z.uuid(), userId: z.uuid() }),
  batch: {
    group: 'adiutor-tests-ticket-email',
    /**
     * The key: the ticket and the person.
     *
     * @param about - The job's payload.
     * @returns The key.
     */
    key: (about) => `${about.ticketId}:${about.userId}`,
  },
});

describe('queueJob', () => {
  it('stores a job with its kind and checked payload', async () => {
    const userId = randomUUID();

    const id = await queueJob(db, note, { userId, note: 'hello' });

    expect(await db.select().from(queuedJob).where(eq(queuedJob.id, id))).toEqual([
      expect.objectContaining({
        kind: 'adiutor-tests-note',
        payload: { userId, note: 'hello' },
        status: 'queued',
        attempts: 0,
        batchKey: null,
      }),
    ]);
  });

  it('refuses a payload that does not fit, and stores nothing', async () => {
    await expect(queueJob(db, note, { userId: 'not-an-id', note: 'hello' })).rejects.toThrow(
      ZodError,
    );
    expect(await db.select().from(queuedJob)).toEqual([]);
  });

  it('stores the batch key of a batched kind’s job', async () => {
    const [ticketId, userId] = [randomUUID(), randomUUID()];

    const id = await queueJob(db, commented, { ticketId, userId });

    expect(
      await db.select({ batchKey: queuedJob.batchKey }).from(queuedJob).where(eq(queuedJob.id, id)),
    ).toEqual([{ batchKey: `adiutor-tests-ticket-email:${ticketId}:${userId}` }]);
  });
});

describe('defineQueuedKind', () => {
  it('reads only the jobs of its own kind', () => {
    const payload = { ticketId: randomUUID(), userId: randomUUID() };

    expect(commented.read({ kind: 'adiutor-tests-commented', payload })).toEqual(payload);
    expect(commented.read({ kind: 'adiutor-tests-note', payload })).toBeNull();
    expect(note.batchKey({ userId: randomUUID(), note: 'x' })).toBeNull();
  });
});
