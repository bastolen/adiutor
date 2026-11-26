/**
 * @file Makes a later attempt of a delivery to a webhook
 * (`webhookDeliveryJob`), when it's due: the delivery's own attempts, after
 * the first the `request-update` job made (decision 0046). It's skipped when
 * the attempt is already recorded, the delivery isn't pending any more, its
 * webhook is off or its news is gone. A receiver that fails is recorded on
 * the delivery, never thrown.
 */
import { webhookDeliveryJob } from '../../queue';
import { attemptDelivery } from '../../webhooks';
import { handleQueuedJob } from '../define';

export default handleQueuedJob(
  webhookDeliveryJob,
  /**
   * Makes the attempt.
   *
   * @param ctx - Service context.
   * @param job - The job.
   * @returns `done` when it was sent, `skipped` otherwise.
   */
  (ctx, job) => attemptDelivery(ctx, job.payload.deliveryId, job.payload.attempt),
);
