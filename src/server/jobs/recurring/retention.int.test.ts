/**
 * @file Integration tests for the daily job that deletes what's kept only
 * for a while, a chunk at a time until its deadline, against the test
 * database.
 */
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { appError, auditEvent, jobRun, queuedJob, signInError, webhookDelivery } from '@/db/schema';

import {
  auditEvents,
  createCompany,
  later,
  setupTestContext,
  storeRequest,
  storeWebhook,
} from '../../../../tests/integration/helpers';
import retention, { RETENTION_CHUNK_ROWS } from './retention';

const { ctx, db } = setupTestContext();

describe('retention', () => {
  it('removes audit events after a year', async () => {
    await db
      .insert(auditEvent)
      .values([{ action: 'sign_in', at: sql`now() - interval '400 days'` }, { action: 'sign_in' }]);

    await expect(retention.run(ctx, { deadline: later })).resolves.toMatchObject({
      summary: { auditEvents: 1 },
    });
    expect(await auditEvents(db)).toHaveLength(1);
  });

  it('removes errors in the app after 7 days', async () => {
    await db.insert(appError).values([
      {
        reference: 'OLD2-OLD2',
        source: 'server',
        createdAt: sql`now() - interval '8 days'`,
      },
      { reference: 'NEW2-NEW2', source: 'browser', createdAt: sql`now() - interval '6 days'` },
    ]);

    await expect(retention.run(ctx, { deadline: later })).resolves.toMatchObject({
      summary: { appErrors: 1 },
    });
    expect(
      (await db.select({ reference: appError.reference }).from(appError)).map(
        ({ reference }) => reference,
      ),
    ).toEqual(['NEW2-NEW2']);
  });

  it('removes sign-in errors after 7 days', async () => {
    await db.insert(signInError).values([
      { reference: 'OLD2-OLD2', code: 'state_mismatch', createdAt: sql`now() - interval '8 days'` },
      { reference: 'NEW2-NEW2', code: 'state_mismatch', createdAt: sql`now() - interval '6 days'` },
    ]);

    await expect(retention.run(ctx, { deadline: later })).resolves.toMatchObject({
      summary: { signInErrors: 1 },
    });
    expect(
      (await db.select({ reference: signInError.reference }).from(signInError)).map(
        ({ reference }) => reference,
      ),
    ).toEqual(['NEW2-NEW2']);
  });

  it('removes the history of job runs after 30 days', async () => {
    await db.insert(jobRun).values([
      {
        job: 'retention',
        trigger: 'tick',
        startedAt: sql`now() - interval '31 days'`,
        status: 'succeeded',
      },
      { job: 'retention', trigger: 'tick', startedAt: sql`now()`, status: 'succeeded' },
    ]);

    await expect(retention.run(ctx, { deadline: later })).resolves.toMatchObject({
      summary: { jobRuns: 1 },
    });
    expect(await db.select().from(jobRun)).toHaveLength(1);
  });

  it('deletes a chunk at a time: one per table once its deadline has passed, the rest before it', async () => {
    /**
     * Adds audit events older than a year.
     *
     * @param count - How many.
     */
    const oldEvents = async (count: number) => {
      await db.execute(
        sql`insert into audit_event (action, at) select 'sign_in', now() - interval '400 days' from generate_series(1, ${count})`,
      );
    };
    await oldEvents(RETENTION_CHUNK_ROWS + 1);
    await db.insert(appError).values({
      reference: 'OLD2-OLD2',
      source: 'server',
      createdAt: sql`now() - interval '8 days'`,
    });

    // Past its deadline, every table still gets one chunk.
    await expect(retention.run(ctx, { deadline: new Date(0) })).resolves.toMatchObject({
      summary: { auditEvents: RETENTION_CHUNK_ROWS, appErrors: 1 },
    });

    // Before it, the chunks go on until nothing is left.
    await oldEvents(RETENTION_CHUNK_ROWS);
    await expect(retention.run(ctx, { deadline: later })).resolves.toMatchObject({
      summary: { auditEvents: RETENTION_CHUNK_ROWS + 1 },
    });
    expect(await auditEvents(db)).toEqual([]);
  });

  it('removes queued jobs 30 days after they were done, but never waiting ones', async () => {
    const longAgo = sql`now() - interval '31 days'`;
    await db.insert(queuedJob).values([
      { kind: 'adiutor-tests', status: 'succeeded', finishedAt: longAgo },
      { kind: 'adiutor-tests', status: 'failed', finishedAt: longAgo },
      { kind: 'adiutor-tests', status: 'succeeded', finishedAt: sql`now()` },
      { kind: 'adiutor-tests', status: 'queued', runAt: longAgo },
    ]);

    await expect(retention.run(ctx, { deadline: later })).resolves.toMatchObject({
      summary: { queuedJobs: 2 },
    });
    expect(
      (await db.select({ status: queuedJob.status }).from(queuedJob)).map(({ status }) => status),
    ).toEqual(expect.arrayContaining(['succeeded', 'queued']));
    expect(await db.select().from(queuedJob)).toHaveLength(2);
  });

  it('removes deliveries to webhooks after 30 days, whatever their status', async () => {
    const company = await createCompany(db);
    const { id: requestId } = await storeRequest(db, company.id);
    const webhookId = await storeWebhook(db);
    const longAgo = sql`now() - interval '31 days'`;
    await db.insert(webhookDelivery).values([
      { webhookId, requestId, status: 'delivered', createdAt: longAgo },
      { webhookId, requestId, status: 'pending', createdAt: longAgo },
      { webhookId, test: true, status: 'failed', createdAt: longAgo },
      { webhookId, requestId, status: 'delivered' },
    ]);

    await expect(retention.run(ctx, { deadline: later })).resolves.toMatchObject({
      summary: { webhookDeliveries: 3 },
    });
    expect(await db.select().from(webhookDelivery)).toHaveLength(1);
  });
});
