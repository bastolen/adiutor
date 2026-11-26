/**
 * @file The queued jobs of webhooks beyond their news (which the
 * `request-update` job carries): a delivery's later attempts
 * (`webhook-delivery`, one job per attempt, at the moment it's due) and the
 * email that tells a staff Admin a webhook was turned off
 * (`webhook-turned-off`, one job per Admin). Their payloads hold IDs and
 * small settings only.
 */
import { z } from 'zod';

import { WEBHOOK_MAX_ATTEMPTS } from '@/lib/webhooks';

import { defineQueuedKind } from './define';

/**
 * One later attempt of a delivery to a webhook, queued for when it's due.
 * A receiver's failure isn't the job's: the job only fails, and is tried
 * again on the queue's own schedule, for Adiutor's own faults.
 */
export const webhookDeliveryJob = defineQueuedKind({
  name: 'webhook-delivery',
  maxAttempts: 3,
  payload: z.object({
    /** The delivery. */
    deliveryId: z.uuid(),
    /** Which attempt this is: the job of an attempt that's already recorded does nothing. */
    attempt: z.int().min(2).max(WEBHOOK_MAX_ATTEMPTS),
  }),
});

/** The "a webhook was turned off" email to one staff Admin. */
export const webhookTurnedOffJob = defineQueuedKind({
  name: 'webhook-turned-off',
  payload: z.object({
    /** The staff Admin to tell. */
    recipientId: z.uuid(),
    /** The webhook. */
    webhookId: z.uuid(),
    /**
     * Why Adiutor turned it off: its deliveries failed for days (`failing`),
     * its receiver said it's gone (`gone`), or its address or secret can't be
     * read any more (`unreadable`).
     */
    reason: z.enum(['failing', 'gone', 'unreadable']),
  }),
});
