/**
 * @file The queue of background jobs (docs/jobs.md): declaring a kind of
 * queued job (`defineQueuedKind`), adding jobs of it (`queueJob`), and the
 * kinds the app queues. It knows nothing of what jobs do: their handlers and the runner live in
 * `src/server/jobs`, which imports the code it runs. So code anywhere can
 * queue a job without an import cycle.
 *
 * This is the module's public API: nothing outside this folder imports its
 * files directly.
 */
export { defineQueuedKind } from './define';
export type { JobPayload, QueuedJobKind } from './define';
export { queueJob } from './queue-job';
export { addedToCompanyJob, staffAdminAddedJob } from './people-emails';
export { REQUEST_UPDATES_GROUP, requestUpdateJob } from './request-updates';
export type { RequestUpdateEvent } from './request-updates';
export { securityNoticeJob } from './security-notice';
export type { SecurityNoticePayload } from './security-notice';
