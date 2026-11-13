/**
 * @file Integration tests for what the Jobs page shows, against the test
 * database: every recurring job and kind of queued job with its state, the
 * runs newest first with the staff Admin who started one, and only the
 * queued jobs that were given up. Who may see them is in the authorization
 * matrix.
 */
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { jobRun, jobState, queuedJob } from '@/db/schema';

import { setupTestContext, staffActor } from '../../../tests/integration/helpers';
import { listFailedJobs, listJobRuns, loadJobsOverview } from './overview';

const { ctx, db } = setupTestContext();

describe('loadJobsOverview', () => {
  it('lists every recurring job and kind of queued job with its state', async () => {
    const manager = await staffActor(db, 'manager', 'sam@adiutor.test');
    await db.insert(jobState).values({ name: 'retention', pausedAt: sql`now()` });
    await db
      .insert(queuedJob)
      .values([
        { kind: 'security-notice' },
        { kind: 'security-notice', status: 'failed', finishedAt: sql`now()` },
      ]);

    const overview = await loadJobsOverview(ctx, manager);

    expect(overview.recurring.map(({ name, paused }) => ({ name, paused }))).toEqual([
      { name: 'leftover-provider-tokens', paused: false },
      { name: 'finished-sign-ins-as-users', paused: false },
      { name: 'expired-sign-in-data', paused: false },
      { name: 'invitation-reminders', paused: false },
      { name: 'retention', paused: true },
    ]);
    expect(overview.queued).toEqual([
      {
        name: 'security-notice',
        known: true,
        pausable: false,
        paused: false,
        waiting: 1,
        failed: 1,
      },
      {
        name: 'added-to-company',
        known: true,
        pausable: true,
        paused: false,
        waiting: 0,
        failed: 0,
      },
      {
        name: 'staff-admin-added',
        known: true,
        pausable: false,
        paused: false,
        waiting: 0,
        failed: 0,
      },
    ]);
  });

  it('gives a job whose last run failed that run’s error reference', async () => {
    const manager = await staffActor(db, 'manager', 'sam@adiutor.test');
    await db.insert(jobState).values([
      { name: 'invitation-reminders', lastStatus: 'failed', lastStartedAt: sql`now()` },
      { name: 'retention', lastStatus: 'succeeded', lastStartedAt: sql`now()` },
    ]);
    await db.insert(jobRun).values([
      {
        job: 'invitation-reminders',
        trigger: 'tick',
        startedAt: new Date('2026-11-10T09:10:00Z'),
        status: 'failed',
        errorReference: 'AAAA-BBBB',
      },
      {
        job: 'invitation-reminders',
        trigger: 'tick',
        startedAt: new Date('2026-11-11T09:10:00Z'),
        status: 'failed',
        errorReference: 'CCCC-DDDD',
      },
      // An earlier failure of a job whose last run went well.
      {
        job: 'retention',
        trigger: 'tick',
        startedAt: new Date('2026-11-10T03:15:00Z'),
        status: 'failed',
        errorReference: 'EEEE-FFFF',
      },
    ]);

    const { recurring } = await loadJobsOverview(ctx, manager);

    expect(Object.fromEntries(recurring.map((job) => [job.name, job.lastErrorReference]))).toEqual({
      'leftover-provider-tokens': null,
      'finished-sign-ins-as-users': null,
      'expired-sign-in-data': null,
      'invitation-reminders': 'CCCC-DDDD',
      retention: null,
    });
  });
});

describe('listJobRuns', () => {
  it('lists runs newest first, naming the staff Admin who started one', async () => {
    const admin = await staffActor(db, 'platform_admin', 'alex@adiutor.test');
    await db.insert(jobRun).values([
      {
        job: 'retention',
        trigger: 'tick',
        startedAt: new Date('2026-11-10T03:15:00Z'),
        status: 'succeeded',
        summary: { auditEvents: 2 },
      },
      {
        job: 'invitation-reminders',
        trigger: 'page',
        startedBy: admin.id,
        startedAt: new Date('2026-11-11T09:00:00Z'),
        status: 'failed',
        summary: { sent: 1, failed: 1 },
        errorReference: '7KQ2-M9XD',
      },
    ]);

    const runs = await listJobRuns(ctx, admin);

    expect(runs.total).toBe(2);
    expect(runs.items).toEqual([
      expect.objectContaining({
        job: 'invitation-reminders',
        trigger: 'page',
        startedBy: { id: admin.id, name: expect.any(String), email: 'alex@adiutor.test' },
        status: 'failed',
        summary: { sent: 1, failed: 1 },
        errorReference: '7KQ2-M9XD',
      }),
      expect.objectContaining({ job: 'retention', startedBy: null, summary: { auditEvents: 2 } }),
    ]);
    // Oldest first when asked.
    expect(
      (await listJobRuns(ctx, admin, { sort: 'time', dir: 'asc' })).items.map(({ job }) => job),
    ).toEqual(['retention', 'invitation-reminders']);
  });
});

describe('listFailedJobs', () => {
  it('lists only the jobs that were given up, latest first, without their payloads', async () => {
    const admin = await staffActor(db, 'platform_admin', 'alex@adiutor.test');
    await db.insert(queuedJob).values([
      { kind: 'security-notice', status: 'queued' },
      { kind: 'security-notice', status: 'succeeded', finishedAt: sql`now()` },
      {
        kind: 'security-notice',
        status: 'failed',
        attempts: 5,
        finishedAt: new Date('2026-11-10T10:00:00Z'),
        lastErrorReference: 'AAAA-BBBB',
      },
      {
        kind: 'added-to-company',
        status: 'failed',
        attempts: 5,
        finishedAt: new Date('2026-11-11T10:00:00Z'),
        lastErrorReference: 'CCCC-DDDD',
      },
    ]);

    const failed = await listFailedJobs(ctx, admin);

    expect(failed.total).toBe(2);
    expect(failed.items).toEqual([
      {
        id: expect.any(String),
        kind: 'added-to-company',
        known: true,
        attempts: 5,
        queuedAt: expect.any(Date),
        failedAt: new Date('2026-11-11T10:00:00Z'),
        errorReference: 'CCCC-DDDD',
      },
      expect.objectContaining({ kind: 'security-notice', errorReference: 'AAAA-BBBB' }),
    ]);
  });
});
