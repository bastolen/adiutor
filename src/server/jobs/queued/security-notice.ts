/**
 * @file Sends a queued security notice (`securityNoticeJob`): reads the
 * recipient, the names the notice gives and, for the user's own change, the
 * device, IP address and time from the change's audit event, then emails
 * it in the user's language. A user who's gone by then is skipped; a mail
 * problem throws, so the job is tried again later.
 */
import { eq } from 'drizzle-orm';

import { auditEvent, company, user } from '@/db/schema';
import displayName from '@/lib/display-name';
import { providerLabel } from '@/lib/sign-in/oauth-providers';

import buildSecurityNotice from '../../auth/security-notice-email';
import getStaffName from '../../people/staff-name';
import { securityNoticeJob } from '../../queue';
import { handleQueuedJob } from '../define';

export default handleQueuedJob(
  securityNoticeJob,
  /**
   * Sends one notice.
   *
   * @param ctx - Service context.
   * @param job - The job.
   * @returns `done`, or `skipped` when the user is gone.
   */
  async (ctx, job) => {
    const { userId, kind, auditEventId, providerId, role, companyId, staffUserId } = job.payload;
    const [recipient] = await ctx.db
      .select({ email: user.email, locale: user.locale })
      .from(user)
      .where(eq(user.id, userId));
    if (!recipient) {
      return 'skipped';
    }
    const [[event], [theCompany], [staffMember], staffName] = await Promise.all([
      auditEventId
        ? ctx.db
            .select({ at: auditEvent.at, ip: auditEvent.ip, userAgent: auditEvent.userAgent })
            .from(auditEvent)
            .where(eq(auditEvent.id, auditEventId))
        : [],
      companyId
        ? ctx.db.select({ name: company.name }).from(company).where(eq(company.id, companyId))
        : [],
      staffUserId
        ? ctx.db
            .select({ name: user.name, email: user.email })
            .from(user)
            .where(eq(user.id, staffUserId))
        : [],
      getStaffName(ctx.db),
    ]);
    await ctx.sendEmail(
      await buildSecurityNotice(ctx, {
        email: recipient.email,
        savedLocale: recipient.locale,
        kind,
        // The change's own time when its event says; else when it was queued, right after it.
        when: event?.at ?? job.queuedAt,
        origin: event ? { ip: event.ip, userAgent: event.userAgent } : null,
        provider: providerId ? providerLabel(providerId) : undefined,
        role: role ?? undefined,
        company: theCompany?.name,
        staffMember: staffMember ? displayName(staffMember) : undefined,
        staffName,
      }),
    );
    return 'done';
  },
);
