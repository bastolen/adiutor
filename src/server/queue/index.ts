/**
 * @file The queue of background jobs (docs/jobs.md): declaring a kind of
 * queued job (`defineQueuedKind`), adding jobs of it (`queueJob`, `queueJobs`), and the
 * kinds the app queues. It knows nothing of what jobs do: their handlers and the runner live in
 * `src/server/jobs`, which imports the code it runs. So code anywhere can
 * queue a job without an import cycle.
 *
 * This is the module's public API: nothing outside this folder imports its
 * files directly.
 */
export { defineQueuedKind } from './define';
export type { JobPayload, QueuedJobKind } from './define';
export { queueJob, queueJobs } from './queue-job';
export { smtpChangedJob } from './mail-server-emails';
export { addedToCompanyJob, staffAdminAddedJob } from './people-emails';
export { isWebhookNews, REQUEST_UPDATES_GROUP, requestUpdateJob } from './request-updates';
export type { RequestUpdateEvent, WebhookNewsPayload } from './request-updates';
export { securityNoticeJob } from './security-notice';
export { webhookDeliveryJob, webhookTurnedOffJob } from './webhooks';
export type { SecurityNoticePayload } from './security-notice';
