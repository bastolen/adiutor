/**
 * @file The queue of background jobs (docs/jobs.md): declaring a kind of
 * queued job (`defineQueuedKind`), adding jobs of it (`queueJob`), and the
 * kinds the app queues (`securityNoticeJob`). It
 * knows nothing of what jobs do: their handlers and the runner live in
 * `src/server/jobs`, which imports the code it runs. So code anywhere can
 * queue a job without an import cycle.
 *
 * This is the module's public API: nothing outside this folder imports its
 * files directly.
 */
export { DEFAULT_MAX_ATTEMPTS, DEFAULT_PER_TICK, defineQueuedKind } from './define';
export type {
  JobBatching,
  JobPayload,
  JobPayloadValue,
  QueuedJobKind,
  QueuedKindDefinition,
} from './define';
export { queueJob } from './queue-job';
export type { QueueOptions } from './queue-job';
export { securityNoticeJob } from './security-notice';
export type { SecurityNoticePayload } from './security-notice';
