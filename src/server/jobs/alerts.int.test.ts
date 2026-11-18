/**
 * @file Integration tests for telling the staff Admins that a job keeps
 * failing, against the test database: after three failed runs in a row
 * (a run that never finished counts), or when queued jobs are given up; only active staff Admins, in their own
 * language; at most once a day per job, unless the alert reached nobody; and
 * a mail problem never stops the tick.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { jobState, user } from '@/db/schema';

import {
  later,
  mailDown,
  setupTestContext,
  setUserLocale,
  staffActor,
} from '../../../tests/integration/helpers';
import type { ServiceContext } from '../context';
import { defineQueuedKind, queueJob } from '../queue';
import { defineRecurringJob, handleQueuedJob } from './define';
import { runQueue } from './run-queue';
import { runTick } from './tick';

const { ctx, db, sent } = setupTestContext();

/** A recurring job that always fails. */
const broken = defineRecurringJob({
  name: 'adiutor-tests-broken',
  schedule: '0 * * * *',
  /**
   * Fails.
   *
   * @returns Never.
   */
  run: async () => {
    throw new Error('Adiutor Tests: the job broke');
  },
});

/**
 * A moment on a day far from today, in UTC.
 *
 * @param hour - The hour.
 * @returns The moment, half past that hour.
 */
function at(hour: number): Date {
  return new Date(`2030-01-15T${String(hour).padStart(2, '0')}:30:00Z`);
}

/**
 * Runs the broken job in a tick at an hour.
 *
 * @param hour - The hour.
 * @param context - The service context; the test one by default.
 */
async function tickAt(hour: number, context: ServiceContext = ctx) {
  await runTick(context, { trigger: 'tick', deadline: later, now: at(hour), jobs: [broken] });
}

let alex: string;

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  alex = (await staffActor(db, 'platform_admin', 'alex@adiutor.test')).id;
  await staffActor(db, 'platform_admin', 'blake@adiutor.test');
  const gone = await staffActor(db, 'platform_admin', 'gone@adiutor.test');
  await db
    .update(user)
    .set({ deactivatedAt: sql`now()` })
    .where(eq(user.id, gone.id));
  await staffActor(db, 'manager', 'morgan@adiutor.test');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Who got an email about the job.
 *
 * @returns Their addresses, sorted.
 */
function alerted() {
  return sent
    .filter((email) => email.subject.includes('adiutor-tests-broken'))
    .map((email) => email.to)
    .sort();
}

describe('alerts about a recurring job', () => {
  it('tell the active staff Admins after three failed runs in a row', async () => {
    await tickAt(10);
    await tickAt(11);
    expect(alerted()).toEqual([]);

    await tickAt(12);

    expect(alerted()).toEqual(['alex@adiutor.test', 'blake@adiutor.test']);
    const [email] = sent.filter((one) => one.to === 'alex@adiutor.test');
    expect(email?.text).toContain('failed its last 3 runs in a row');
    expect(email?.text).toMatch(/https:\/\/adiutor\.test\/admin\/logs\/errors\?q=[A-Z0-9-]+/);
  });

  it('go out at most once a day per job', async () => {
    await tickAt(10);
    await tickAt(11);
    await tickAt(12);
    await tickAt(13);
    expect(alerted()).toHaveLength(2);

    // A day later, it's still failing: they're told again.
    await db
      .update(jobState)
      .set({ lastAlertAt: sql`now() - interval '25 hours'` })
      .where(eq(jobState.name, broken.name));
    await tickAt(14);
    expect(alerted()).toHaveLength(4);
  });

  it('are written in each Admin’s own language', async () => {
    await setUserLocale(db, alex, 'nl-NL');
    await tickAt(10);
    await tickAt(11);
    await tickAt(12);

    expect(sent.find((email) => email.to === 'alex@adiutor.test')?.subject).toBe(
      'Achtergrondtaak adiutor-tests-broken blijft mislukken op Adiutor',
    );
  });

  it('count a run that never finished as a failure', async () => {
    // Two failed runs in a row, then a run at 10:20 that died: its lease ran out a minute ago.
    await db.insert(jobState).values({
      name: broken.name,
      lastStartedAt: new Date('2030-01-15T10:20:00Z'),
      lockedUntil: sql`now() - interval '1 minute'`,
      consecutiveFailures: 2,
    });

    // At 10:30 it isn't due again, but the run that died is recorded: the third failure.
    await tickAt(10);

    expect(alerted()).toEqual(['alex@adiutor.test', 'blake@adiutor.test']);
  });

  it('never stop the tick when the mail server is down', async () => {
    await tickAt(10, mailDown(ctx));
    await tickAt(11, mailDown(ctx));
    await expect(tickAt(12, mailDown(ctx))).resolves.toBeUndefined();
  });

  it('go out with the next failure when no email could be sent', async () => {
    // The Admins were last told over a day ago; that moment comes back when today's alert fails.
    await db
      .insert(jobState)
      .values({ name: broken.name, lastAlertAt: sql`now() - interval '25 hours'` });
    const [before] = await db.select({ lastAlertAt: jobState.lastAlertAt }).from(jobState);
    await tickAt(10, mailDown(ctx));
    await tickAt(11, mailDown(ctx));
    await tickAt(12, mailDown(ctx));
    expect(alerted()).toEqual([]);
    expect(await db.select({ lastAlertAt: jobState.lastAlertAt }).from(jobState)).toEqual([before]);

    // The mail server is back: the very next failed run tells them, without a day's wait.
    await tickAt(13);

    expect(alerted()).toEqual(['alex@adiutor.test', 'blake@adiutor.test']);
  });

  it('count as the day’s alert once one Admin was emailed', async () => {
    /** The context, with a mail server that refuses one Admin's address. */
    const refusingAlex: ServiceContext = {
      ...ctx,
      /**
       * Sends to everyone but Alex.
       *
       * @param email - The email.
       */
      sendEmail: async (email) => {
        if (email.to === 'alex@adiutor.test') {
          throw new Error('Adiutor Tests: the mail server refused the address');
        }
        await ctx.sendEmail(email);
      },
    };
    await tickAt(10, refusingAlex);
    await tickAt(11, refusingAlex);
    await tickAt(12, refusingAlex);
    expect(alerted()).toEqual(['blake@adiutor.test']);

    await tickAt(13);

    expect(alerted()).toEqual(['blake@adiutor.test']);
  });
});

describe('alerts about queued jobs', () => {
  it('tell the staff Admins when queued jobs are given up', async () => {
    const hopeless = handleQueuedJob(
      defineQueuedKind({
        name: 'adiutor-tests-hopeless',
        payload: z.object({ userId: z.uuid() }),
        maxAttempts: 1,
      }),
      /**
       * Fails.
       *
       * @returns Never.
       */
      async () => {
        throw new Error('Adiutor Tests: the job broke');
      },
    );
    await queueJob(db, hopeless, { userId: randomUUID() });
    await queueJob(db, hopeless, { userId: randomUUID() });

    await runQueue(ctx, {
      trigger: 'tick',
      deadline: later,
      startedAt: new Date(),
      kinds: [hopeless],
    });

    const emails = sent.filter((email) => email.subject.includes('adiutor-tests-hopeless'));
    expect(emails.map((email) => email.to).sort()).toEqual([
      'alex@adiutor.test',
      'blake@adiutor.test',
    ]);
    expect(emails[0]?.text).toContain('2 adiutor-tests-hopeless jobs were given up');
  });
});
