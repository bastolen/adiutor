/**
 * @file Sends a queued "a webhook was turned off" email
 * (`webhookTurnedOffJob`) to one staff Admin, in their language: Adiutor
 * turned a webhook off because its deliveries kept failing, its receiver is
 * gone, or its address or secret can't be read. It's skipped when the
 * recipient no longer manages webhooks or is deactivated, or the webhook is
 * gone or on again. A mail problem throws, so the job is tried again later.
 */
import { eq } from 'drizzle-orm';

import { user, webhook } from '@/db/schema';
import { webhookTurnedOffEmail } from '@/emails/webhook-turned-off';
import { getGlobalPermissions } from '@/lib/authz/permissions';

import { loadEmailBrand } from '../../branding';
import { webhookTurnedOffJob } from '../../queue';
import recipientLocale from '../../recipient-locale';
import { handleQueuedJob } from '../define';

export default handleQueuedJob(
  webhookTurnedOffJob,
  /**
   * Sends one email.
   *
   * @param ctx - Service context.
   * @param job - The job.
   * @returns `done`, or `skipped` when the recipient or the webhook is no longer one to tell of.
   */
  async (ctx, job) => {
    const { recipientId, webhookId, reason } = job.payload;
    const [[recipient], [found]] = await Promise.all([
      ctx.db
        .select({
          email: user.email,
          locale: user.locale,
          platformRole: user.platformRole,
          deactivatedAt: user.deactivatedAt,
        })
        .from(user)
        .where(eq(user.id, recipientId)),
      ctx.db
        .select({ name: webhook.name, turnedOffReason: webhook.turnedOffReason })
        .from(webhook)
        .where(eq(webhook.id, webhookId)),
    ]);
    if (
      !recipient ||
      recipient.deactivatedAt !== null ||
      !getGlobalPermissions(recipient).has('staff:manage') ||
      !found ||
      found.turnedOffReason !== reason
    ) {
      return 'skipped';
    }
    await ctx.sendEmail(
      await webhookTurnedOffEmail(recipient.email, {
        appUrl: ctx.baseUrl,
        brand: await loadEmailBrand(ctx.db),
        locale: await recipientLocale(ctx, recipient.locale),
        name: found.name,
        reason,
        url: `${ctx.baseUrl}/admin/settings/webhooks/${webhookId}`,
      }),
    );
    return 'done';
  },
);
