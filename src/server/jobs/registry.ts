/**
 * @file Every background job Adiutor has. A new job gets a file of its own
 * (in `recurring/` or `queued/`) and a line here; see docs/jobs.md.
 */
import type { JobBatch, QueuedJobRunner, RecurringJob } from './define';
import addedToCompanyJob from './queued/added-to-company';
import { requestUpdateRunner, requestUpdatesBatch } from './queued/request-updates';
import securityNoticeJob from './queued/security-notice';
import staffAdminAddedJob from './queued/staff-admin-added';
import expiredSignInData from './recurring/expired-sign-in-data';
import finishedSignInsAsUsers from './recurring/finished-sign-ins-as-users';
import invitationReminders from './recurring/invitation-reminders';
import leftoverProviderTokens from './recurring/leftover-provider-tokens';
import retention from './recurring/retention';

/** The recurring jobs, in the order the tick runs them when several are due. */
export const RECURRING_JOBS: readonly RecurringJob[] = [
  leftoverProviderTokens,
  finishedSignInsAsUsers,
  expiredSignInData,
  invitationReminders,
  retention,
];

/**
 * Finds a recurring job by name.
 *
 * @param name - The job's name.
 * @returns The job, or `undefined` when there's none by that name.
 */
export function findRecurringJob(name: string): RecurringJob | undefined {
  return RECURRING_JOBS.find((job) => job.name === name);
}

/** The kinds of queued job; the tick only runs jobs of kinds listed here. */
export const QUEUED_JOBS: readonly QueuedJobRunner[] = [
  securityNoticeJob,
  addedToCompanyJob,
  staffAdminAddedJob,
  requestUpdateRunner,
];

/**
 * Finds a kind of queued job by name.
 *
 * @param name - The kind's name.
 * @returns The kind, or `undefined` when the registry lists none by that name.
 */
export function findQueuedKind(name: string): QueuedJobRunner | undefined {
  return QUEUED_JOBS.find((kind) => kind.name === name);
}

/** The batches of the batch groups that kinds of queued job name in `batch.group`. */
export const JOB_BATCHES: readonly JobBatch[] = [requestUpdatesBatch];
