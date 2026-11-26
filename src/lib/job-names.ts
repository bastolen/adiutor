/**
 * @file The names of the background jobs and the counts their runs report,
 * so the Jobs page can describe them in the reader's language
 * (`jobs.descriptions.<name>` and `jobs.summary.<count>`). The registry
 * (`src/server/jobs/registry.ts`) lists exactly these jobs, which
 * `registry.int.test.ts` checks; a run's summary can only hold these counts
 * (`JobSummary` in `src/server/jobs/define.ts`).
 */

/**
 * How a job's name looks: kebab-case, as the command line, the docs and the
 * emails write it. `defineRecurringJob` and `defineQueuedKind` refuse others.
 */
export const JOB_NAME_PATTERN = /^[a-z]+(-[a-z]+)*$/;

/** The recurring jobs, in the order the tick runs them. */
export const RECURRING_JOB_NAMES = [
  'leftover-provider-tokens',
  'finished-sign-ins-as-users',
  'expired-sign-in-data',
  'invitation-reminders',
  'retention',
] as const;

/** The kinds of queued job, in the order the registry lists them. */
export const QUEUED_JOB_NAMES = [
  'security-notice',
  'added-to-company',
  'staff-admin-added',
  'request-update',
  'webhook-delivery',
  'webhook-turned-off',
] as const;

/** A recurring job or a kind of queued job. */
export type JobName = (typeof RECURRING_JOB_NAMES)[number] | (typeof QUEUED_JOB_NAMES)[number];

/**
 * Whether a name is one of the kinds of queued job.
 *
 * @param name - The name.
 * @returns Whether it's in {@link QUEUED_JOB_NAMES}.
 */
function isQueuedJobName(name: string): name is (typeof QUEUED_JOB_NAMES)[number] {
  return (QUEUED_JOB_NAMES as readonly string[]).includes(name);
}

/**
 * Whether a name is one of the jobs, e.g. from the history, which keeps the
 * runs of jobs that were removed since.
 *
 * @param name - The name.
 * @returns Whether it's a recurring job or a kind of queued job.
 */
export function isJobName(name: string): name is JobName {
  return (RECURRING_JOB_NAMES as readonly string[]).includes(name) || isQueuedJobName(name);
}

/** What a run can count; each has its words in `jobs.summary`. */
const JOB_SUMMARY_KEYS = [
  /** Queued jobs: done, skipped, to try again, given up. */
  'done',
  'skipped',
  'retried',
  'failed',
  /** Emails sent, e.g. invitation reminders (their failures are `failed`). */
  'sent',
  /** Provider accounts whose leftover tokens were cleared. */
  'accounts',
  /** Sign-ins as a user that were ended. */
  'ended',
  /**
   * Expired sign-in links and codes, ended links in emails about requests,
   * sessions and finished rate limits deleted.
   */
  'verifications',
  'requestLinks',
  'sessions',
  'rateLimits',
  /** Old audit events, errors, runs and finished queued jobs deleted. */
  'auditEvents',
  'appErrors',
  'signInErrors',
  'jobRuns',
  'queuedJobs',
] as const;

/** One count a run can report. */
export type JobSummaryKey = (typeof JOB_SUMMARY_KEYS)[number];

/**
 * Whether a key is one of the counts, e.g. read back from the history.
 *
 * @param key - The key.
 * @returns Whether it's in {@link JOB_SUMMARY_KEYS}.
 */
export function isJobSummaryKey(key: string): key is JobSummaryKey {
  return (JOB_SUMMARY_KEYS as readonly string[]).includes(key);
}
