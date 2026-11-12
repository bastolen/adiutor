/**
 * @file The daily job that deletes what Adiutor keeps only for a while:
 * audit events after a year, sign-in errors and other recorded errors after
 * 7 days, and the history of job runs after 30 days.
 */
import { lt, sql } from 'drizzle-orm';

import { appError, auditEvent, jobRun, signInError } from '@/db/schema';

import { APP_ERROR_RETENTION_DAYS } from '../../app-errors';
import { SIGN_IN_ERROR_RETENTION_DAYS } from '../../auth/sign-in-errors';
import { defineRecurringJob } from '../define';

/** How long audit events are kept, in days. */
export const AUDIT_RETENTION_DAYS = 365;

/** How long the history of job runs is kept, in days. */
export const JOB_HISTORY_RETENTION_DAYS = 30;

/**
 * The moment a number of days ago, in the database's clock.
 *
 * @param days - How many days.
 * @returns The SQL for it.
 */
function daysAgo(days: number) {
  return sql`now() - make_interval(days => ${days})`;
}

export default defineRecurringJob({
  name: 'retention',
  schedule: '15 3 * * *',
  /**
   * Deletes what's older than it may be kept.
   *
   * @param ctx - Service context (only the database is used).
   * @returns How many rows were deleted per kind.
   */
  run: async (ctx) => {
    const [auditEvents, signInErrors, appErrors, jobRuns] = await Promise.all([
      ctx.db
        .delete(auditEvent)
        .where(lt(auditEvent.at, daysAgo(AUDIT_RETENTION_DAYS)))
        .returning({ id: auditEvent.id }),
      ctx.db
        .delete(signInError)
        .where(lt(signInError.createdAt, daysAgo(SIGN_IN_ERROR_RETENTION_DAYS)))
        .returning({ id: signInError.id }),
      ctx.db
        .delete(appError)
        .where(lt(appError.createdAt, daysAgo(APP_ERROR_RETENTION_DAYS)))
        .returning({ id: appError.id }),
      ctx.db
        .delete(jobRun)
        .where(lt(jobRun.startedAt, daysAgo(JOB_HISTORY_RETENTION_DAYS)))
        .returning({ id: jobRun.id }),
    ]);
    return {
      summary: {
        auditEvents: auditEvents.length,
        signInErrors: signInErrors.length,
        appErrors: appErrors.length,
        jobRuns: jobRuns.length,
      },
    };
  },
});
