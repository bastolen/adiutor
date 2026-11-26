/**
 * @file Sends a queued "someone became a staff Admin" email
 * (`staffAdminAddedJob`) to one staff Admin, in their language, without the
 * device or IP address of whoever made the change. It's skipped when the
 * recipient is no longer an active staff Admin, or the new Admin's account is
 * gone. A mail problem throws, so the job is tried again later.
 */
import { inArray } from 'drizzle-orm';

import { user } from '@/db/schema';
import { staffAdminAddedEmail } from '@/emails/staff-admin-added';
import { PLATFORM_ADMIN_ROLE } from '@/lib/authz/roles';
import displayName from '@/lib/display-name';

import { loadEmailBrand } from '../../branding';
import { staffAdminAddedJob } from '../../queue';
import recipientLocale from '../../recipient-locale';
import { handleQueuedJob } from '../define';

export default handleQueuedJob(
  staffAdminAddedJob,
  /**
   * Sends one email.
   *
   * @param ctx - Service context.
   * @param job - The job.
   * @returns `done`, or `skipped` when the recipient or the new Admin is gone.
   */
  async (ctx, job) => {
    const { recipientId, newAdminId, how, byUserId } = job.payload;
    const people = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        locale: user.locale,
        role: user.platformRole,
        deactivatedAt: user.deactivatedAt,
      })
      .from(user)
      .where(inArray(user.id, [recipientId, newAdminId, ...(byUserId ? [byUserId] : [])]));
    const recipient = people.find((person) => person.id === recipientId);
    const newAdmin = people.find((person) => person.id === newAdminId);
    const by = byUserId ? people.find((person) => person.id === byUserId) : undefined;
    if (
      !newAdmin ||
      !recipient ||
      recipient.role !== PLATFORM_ADMIN_ROLE ||
      recipient.deactivatedAt !== null
    ) {
      return 'skipped';
    }
    await ctx.sendEmail(
      await staffAdminAddedEmail(recipient.email, {
        appUrl: ctx.baseUrl,
        brand: await loadEmailBrand(ctx.db),
        locale: await recipientLocale(ctx, recipient.locale),
        newAdminName: displayName(newAdmin),
        newAdminEmail: newAdmin.email,
        how,
        byName: by ? displayName(by) : null,
        url: `${ctx.baseUrl}/admin/settings/staff`,
      }),
    );
    return 'done';
  },
);
