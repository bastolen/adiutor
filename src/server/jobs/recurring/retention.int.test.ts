/**
 * @file Integration tests for the daily job that deletes what's kept only
 * for a while, against the test database.
 */
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { appError, auditEvent, jobRun } from '@/db/schema';

import { setupTestContext } from '../../../../tests/integration/helpers';
import retention from './retention';

const { ctx, db } = setupTestContext();

/** Far enough away that no test reaches it. */
const deadline = new Date(Date.now() + 60 * 60_000);

describe('retention', () => {
  it('removes audit events after a year', async () => {
    await db
      .insert(auditEvent)
      .values([{ action: 'sign_in', at: sql`now() - interval '400 days'` }, { action: 'sign_in' }]);

    await expect(retention.run(ctx, { deadline })).resolves.toMatchObject({
      summary: { auditEvents: 1 },
    });
    expect(await db.select().from(auditEvent)).toHaveLength(1);
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

    await expect(retention.run(ctx, { deadline })).resolves.toMatchObject({
      summary: { appErrors: 1 },
    });
    expect(
      (await db.select({ reference: appError.reference }).from(appError)).map(
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

    await expect(retention.run(ctx, { deadline })).resolves.toMatchObject({
      summary: { jobRuns: 1 },
    });
    expect(await db.select().from(jobRun)).toHaveLength(1);
  });
});
