/**
 * @file Sends a queued "you were added to a company" email
 * (`addedToCompanyJob`), in the member's language. It's skipped when the
 * member, the company or the membership is gone by then: the email would no
 * longer be true. A mail problem throws, so the job is tried again later.
 */
import { and, eq } from 'drizzle-orm';

import { company, membership, user } from '@/db/schema';
import { addedToCompanyEmail } from '@/emails/added-to-company';
import displayName from '@/lib/display-name';

import { loadEmailBrand } from '../../branding';
import { addedToCompanyJob } from '../../queue';
import recipientLocale from '../../recipient-locale';
import { handleQueuedJob } from '../define';

export default handleQueuedJob(
  addedToCompanyJob,
  /**
   * Sends one email.
   *
   * @param ctx - Service context.
   * @param job - The job.
   * @returns `done`, or `skipped` when the member, the company or the membership is gone.
   */
  async (ctx, job) => {
    const { userId, companyId, role, addedBy } = job.payload;
    const [[member], [adder]] = await Promise.all([
      ctx.db
        .select({ email: user.email, locale: user.locale, companyName: company.name })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .innerJoin(company, eq(company.id, membership.companyId))
        .where(and(eq(membership.userId, userId), eq(membership.companyId, companyId))),
      ctx.db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, addedBy)),
    ]);
    if (!member) {
      return 'skipped';
    }
    await ctx.sendEmail(
      await addedToCompanyEmail(member.email, {
        appUrl: ctx.baseUrl,
        brand: await loadEmailBrand(ctx.db),
        locale: await recipientLocale(ctx, member.locale),
        // The staff member's account may be gone since; the email then names nobody as the adder.
        adderName: adder ? displayName(adder) : null,
        companyName: member.companyName,
        role,
        url: `${ctx.baseUrl}/companies/${companyId}`,
      }),
    );
    return 'done';
  },
);
