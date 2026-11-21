/**
 * @file Integration tests for what the Jobs page shows, against the test
 * database: every recurring job and kind of queued job with its state, the
 * runs newest first with the staff Admin who started one, only the queued
 * jobs that were given up, and when the ticks look stopped (on the Jobs page
 * and, for staff who see the jobs, the dashboard). Who may see them is in
 * the authorization matrix.
 */
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { jobRun, jobState, queuedJob } from '@/db/schema';

import { saveSettings, setupTestContext, staffActor } from '../../../tests/integration/helpers';
import { getTickWarning, listFailedJobs, listJobRuns, loadJobsOverview } from './overview';
import { recordTick } from './tick-record';

const { ctx, db } = setupTestContext();

describe('loadJobsOverview', () => {
  it('gives every recurring job and kind of queued job its state', async () => {
    const manager = await staffActor(db, 'manager', 'sam@adiutor.test');
    await db.insert(jobState).values({ name: 'retention', pausedAt: sql`now()` });
    await db
      .insert(queuedJob)
      .values([
        { kind: 'security-notice' },
        { kind: 'security-notice', status: 'failed', finishedAt: sql`now()` },
      ]);

    const overview = await loadJobsOverview(ctx, manager);

    expect(overview.recurring.filter((job) => job.paused).map((job) => job.name)).toEqual([
      'retention',
    ]);
    expect(overview.queued.find((kind) => kind.name === 'security-notice')).toMatchObject({
      waiting: 1,
      failed: 1,
    });
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

    expect(
      recurring
        .filter((job) => job.lastErrorReference)
        .map(({ name, lastErrorReference }) => ({ name, lastErrorReference })),
    ).toEqual([{ name: 'invitation-reminders', lastErrorReference: 'CCCC-DDDD' }]);
  });
});

describe('the ticks', () => {
  it('give the overview when the last tick started, and whether that is late', async () => {
    const manager = await staffActor(db, 'manager', 'sam@adiutor.test');
    expect(await loadJobsOverview(ctx, manager)).toMatchObject({
      lastTickAt: null,
      tickLate: true,
    });

    await recordTick(db);

    expect(await loadJobsOverview(ctx, manager)).toMatchObject({
      lastTickAt: expect.any(Date),
      tickLate: false,
    });
  });

  it('warn on the dashboard only while late, and only staff who see the jobs', async () => {
    const admin = await staffActor(db, 'platform_admin', 'alex@adiutor.test');
    const support = await staffActor(db, 'support', 'pat@adiutor.test');

    // No tick ever ran.
    await expect(getTickWarning(ctx, admin)).resolves.toEqual({ lastTickAt: null });
    await expect(getTickWarning(ctx, support)).resolves.toBeNull();

    await recordTick(db);
    await expect(getTickWarning(ctx, admin)).resolves.toBeNull();

    await saveSettings(db, { 'jobs.last_tick': new Date(Date.now() - 2 * 60 * 60_000) });
    await expect(getTickWarning(ctx, admin)).resolves.toEqual({ lastTickAt: expect.any(Date) });
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
