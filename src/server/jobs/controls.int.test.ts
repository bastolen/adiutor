/**
 * @file Integration tests for what staff Admins do with the jobs on the Jobs
 * page, against the test database: pausing and resuming (each once),
 * running a recurring job now (kept in the history with who started it, and
 * refused while another run holds it), and retrying or discarding failed
 * queued jobs; each recorded in the audit log with the job's name. Who may
 * do them is in the authorization matrix.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { auditEvent, jobRun, jobState, queuedJob } from '@/db/schema';

import { setupTestContext, staffActor } from '../../../tests/integration/helpers';
import {
  discardFailedJobs,
  pauseJob,
  resumeJob,
  retryFailedJobs,
  runJobFromPage,
} from './controls';

const { ctx, db } = setupTestContext();

/**
 * The audit events recorded.
 *
 * @returns Each event's action, actor and details, oldest first.
 */
async function events() {
  return db
    .select({
      action: auditEvent.action,
      actor: auditEvent.actorUserId,
      details: auditEvent.details,
    })
    .from(auditEvent)
    .orderBy(asc(auditEvent.at), asc(auditEvent.id));
}

/**
 * Adds a queued job that was given up after its last attempt.
 *
 * @param kind - Its kind's name.
 * @returns Its ID.
 */
async function failedJob(kind = 'security-notice'): Promise<string> {
  const [row] = await db
    .insert(queuedJob)
    .values({ kind, status: 'failed', attempts: 5, finishedAt: sql`now()` })
    .returning({ id: queuedJob.id });
  return row?.id ?? '';
}

describe('pauseJob and resumeJob', () => {
  it('pauses and resumes a recurring job once each, recording who did it', async () => {
    const admin = await staffActor(db, 'platform_admin', 'alex@adiutor.test');

    await pauseJob(ctx, admin, 'retention');
    await expect(pauseJob(ctx, admin, 'retention')).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.jobs.alreadyPaused',
    });
    expect(
      await db
        .select({ pausedAt: jobState.pausedAt, pausedBy: jobState.pausedBy })
        .from(jobState)
        .where(eq(jobState.name, 'retention')),
    ).toEqual([{ pausedAt: expect.any(Date), pausedBy: admin.id }]);

    await resumeJob(ctx, admin, 'retention');
    await expect(resumeJob(ctx, admin, 'retention')).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.jobs.notPaused',
    });
    expect(
      await db
        .select({ pausedAt: jobState.pausedAt, pausedBy: jobState.pausedBy })
        .from(jobState)
        .where(eq(jobState.name, 'retention')),
    ).toEqual([{ pausedAt: null, pausedBy: null }]);
    expect(await events()).toEqual([
      { action: 'job_paused', actor: admin.id, details: { job: 'retention' } },
      { action: 'job_resumed', actor: admin.id, details: { job: 'retention' } },
    ]);
  });

  it('pauses a kind of queued job, and knows no other names', async () => {
    const admin = await staffActor(db, 'platform_admin', 'alex@adiutor.test');

    await pauseJob(ctx, admin, 'added-to-company');
    await expect(pauseJob(ctx, admin, 'adiutor-tests-unknown')).rejects.toMatchObject({
      code: 'not_found',
    });

    expect(await db.select({ name: jobState.name }).from(jobState)).toEqual([
      { name: 'added-to-company' },
    ]);
  });

  it('refuses to pause the jobs that keep Adiutor secure, but clears a pause left behind', async () => {
    const admin = await staffActor(db, 'platform_admin', 'alex@adiutor.test');

    await Promise.all(
      [
        'security-notice',
        'staff-admin-added',
        'leftover-provider-tokens',
        'finished-sign-ins-as-users',
      ].map(async (name) => {
        await expect(pauseJob(ctx, admin, name)).rejects.toMatchObject({
          code: 'invalid',
          key: 'errors.jobs.notPausable',
        });
      }),
    );
    expect(await events()).toEqual([]);

    // Paused before it became unpausable: resuming still clears it.
    await db.insert(jobState).values({ name: 'security-notice', pausedAt: sql`now()` });
    await resumeJob(ctx, admin, 'security-notice');
    expect(await db.select({ pausedAt: jobState.pausedAt }).from(jobState)).toEqual([
      { pausedAt: null },
    ]);
  });
});

describe('runJobFromPage', () => {
  it('runs a recurring job now, even while paused, with who started it in the history', async () => {
    const admin = await staffActor(db, 'platform_admin', 'alex@adiutor.test');
    await db.insert(jobState).values({ name: 'retention', pausedAt: sql`now()` });

    const result = await runJobFromPage(ctx, admin, 'retention');

    expect(result).toMatchObject({ job: 'retention', status: 'succeeded' });
    expect(
      await db
        .select({ job: jobRun.job, trigger: jobRun.trigger, startedBy: jobRun.startedBy })
        .from(jobRun),
    ).toEqual([{ job: 'retention', trigger: 'page', startedBy: admin.id }]);
    expect(await events()).toEqual([
      {
        action: 'job_started',
        actor: admin.id,
        details: { job: 'retention', status: 'succeeded' },
      },
    ]);
  });

  it('is refused while another run holds the job, and for a kind of queued job', async () => {
    const admin = await staffActor(db, 'platform_admin', 'alex@adiutor.test');
    await db
      .insert(jobState)
      .values({ name: 'retention', lockedUntil: sql`now() + interval '10 minutes'` });

    await expect(runJobFromPage(ctx, admin, 'retention')).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.jobs.running',
    });
    await expect(runJobFromPage(ctx, admin, 'security-notice')).rejects.toMatchObject({
      code: 'not_found',
    });

    expect(await db.select().from(jobRun)).toEqual([]);
    expect(await events()).toEqual([]);
  });
});

describe('retryFailedJobs and discardFailedJobs', () => {
  it('puts one failed job back, recording its kind, and only once', async () => {
    const admin = await staffActor(db, 'platform_admin', 'alex@adiutor.test');
    const job = await failedJob();

    await expect(retryFailedJobs(ctx, admin, { id: job })).resolves.toBe(1);
    await expect(retryFailedJobs(ctx, admin, { id: job })).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.jobs.noFailedJobs',
    });

    expect(
      await db.select({ status: queuedJob.status, attempts: queuedJob.attempts }).from(queuedJob),
    ).toEqual([{ status: 'queued', attempts: 0 }]);
    expect(await events()).toEqual([
      {
        action: 'queued_jobs_retried',
        actor: admin.id,
        details: { job: 'security-notice', count: 1 },
      },
    ]);
  });

  it('discards every failed job of a kind, even one the registry no longer lists', async () => {
    const admin = await staffActor(db, 'platform_admin', 'alex@adiutor.test');
    await failedJob('adiutor-tests-gone');
    await failedJob('adiutor-tests-gone');
    await failedJob();

    // No tick runs a kind the registry doesn't list, so its jobs can't be retried.
    await expect(retryFailedJobs(ctx, admin, { kind: 'adiutor-tests-gone' })).rejects.toMatchObject(
      { code: 'not_found' },
    );
    await expect(discardFailedJobs(ctx, admin, { kind: 'adiutor-tests-gone' })).resolves.toBe(2);

    expect(
      await db
        .select({ kind: queuedJob.kind, status: queuedJob.status })
        .from(queuedJob)
        .orderBy(asc(queuedJob.id)),
    ).toEqual([
      { kind: 'adiutor-tests-gone', status: 'discarded' },
      { kind: 'adiutor-tests-gone', status: 'discarded' },
      { kind: 'security-notice', status: 'failed' },
    ]);
    expect(await events()).toEqual([
      {
        action: 'queued_jobs_discarded',
        actor: admin.id,
        details: { job: 'adiutor-tests-gone', count: 2 },
      },
    ]);
  });

  it('answers a malformed ID as one that doesn’t exist', async () => {
    const admin = await staffActor(db, 'platform_admin', 'alex@adiutor.test');

    await expect(discardFailedJobs(ctx, admin, { id: 'not-an-id' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
