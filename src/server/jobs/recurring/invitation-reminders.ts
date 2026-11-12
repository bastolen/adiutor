/**
 * @file The hourly job that reminds people of invitations that expire soon.
 */
import { and, eq, exists, gt, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { company, invitation, membership, user } from '@/db/schema';
import { invitationReminderEmail } from '@/emails/invitation-reminder';
import displayName from '@/lib/display-name';
import { sendFailureOf } from '@/lib/email';
import { isLocale } from '@/lib/i18n/locales';
import { generateToken, hashToken } from '@/lib/sign-in/tokens';

import type { ServiceContext } from '../../context';
import getStaffName from '../../people/staff-name';
import { defineRecurringJob } from '../define';

/** How long before an invitation expires its reminder is sent, in hours. */
const REMINDER_BEFORE_HOURS = 48;

/** What {@link sendInvitationReminders} did. */
interface ReminderResults {
  /** Reminders sent. */
  sent: number;
  /** Reminders that couldn't be sent: the next run tries them again. */
  failed: number;
}

/**
 * Emails a reminder for each open invitation that expires within
 * {@link REMINDER_BEFORE_HOURS} hours, once per invitation, for staff and
 * active companies. Each reminder has a new link (the old one stops working),
 * because only a hash of the link's token is stored.
 *
 * A reminder that can't be sent is undone: the invitation gets its old link
 * back and stays due, so the link the invitee has keeps working and the next
 * run tries again. One failure doesn't stop the others. With SMTP, the pooled
 * transport (`src/lib/email.ts`) caps how many go out at once.
 *
 * Invitations whose address already belongs to a member of the company (or,
 * for the staff, to someone on the staff) are skipped: they joined some other
 * way meanwhile (added directly, or with an invite link while signed in), and
 * a fresh link would only keep a way back in alive. They aren't revoked here,
 * which would need the per-address lock and an audit event: they stay in the
 * pending list until they expire, and removing the person revokes them
 * (`revokeInvitationsTo`).
 *
 * Each reminder is in the invitation's language (`invitation.locale`), or in
 * the invitee's own when they have an account with a saved language.
 *
 * @param ctx - Service context.
 * @returns How many reminders were sent, and how many failed.
 */
async function sendInvitationReminders(ctx: ServiceContext): Promise<ReminderResults> {
  const staffName = await getStaffName(ctx.db);
  // The account the invitation is addressed to, if any (`user` is joined as the inviter).
  const invitee = alias(user, 'invitee');
  // The same account, joined for its language (`invitee` is the subquery's).
  const recipient = alias(user, 'recipient');
  // Staff invitations have no company, so the deactivation check passes for them.
  const due = await ctx.db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      // To put back if the reminder can't be sent.
      tokenHash: invitation.tokenHash,
      companyName: company.name,
      inviterName: user.name,
      inviterEmail: user.email,
      // The invitee's own language when they have an account and saved one, else the invitation's.
      recipientLocale: recipient.locale,
      locale: invitation.locale,
    })
    .from(invitation)
    .leftJoin(company, eq(company.id, invitation.companyId))
    .leftJoin(user, eq(user.id, invitation.invitedBy))
    .leftJoin(recipient, eq(recipient.email, invitation.email))
    .where(
      and(
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
        isNull(invitation.reminderSentAt),
        isNull(company.deactivatedAt),
        gt(invitation.expiresAt, sql`now()`),
        lt(invitation.expiresAt, sql`now() + make_interval(hours => ${REMINDER_BEFORE_HOURS})`),
        // Not for invitations that were short-lived from the start.
        lt(invitation.createdAt, sql`now() - interval '1 day'`),
        // Not for someone who's already in: a member of the company, or on the staff.
        notExists(
          ctx.db
            .select({ one: sql`1` })
            .from(invitee)
            .where(
              and(
                eq(invitee.email, invitation.email),
                or(
                  and(isNull(invitation.companyId), isNotNull(invitee.platformRole)),
                  exists(
                    ctx.db
                      .select({ one: sql`1` })
                      .from(membership)
                      .where(
                        and(
                          eq(membership.userId, invitee.id),
                          eq(membership.companyId, invitation.companyId),
                        ),
                      ),
                  ),
                ),
              ),
            ),
        ),
      ),
    );

  const results = await Promise.all(
    due.map(async (found) => {
      const targetName = found.companyName ?? staffName;
      const token = generateToken();
      const tokenHash = hashToken(token);
      // Claim the reminder first, so two runs at once don't both send it.
      const [claimed] = await ctx.db
        .update(invitation)
        .set({ tokenHash, reminderSentAt: sql`now()` })
        .where(and(eq(invitation.id, found.id), isNull(invitation.reminderSentAt)))
        .returning({ id: invitation.id });
      if (!claimed) {
        return 'skipped';
      }
      try {
        await ctx.sendEmail(
          await invitationReminderEmail(found.email, {
            appUrl: ctx.baseUrl,
            locale: isLocale(found.recipientLocale) ? found.recipientLocale : found.locale,
            // The inviter's account may be gone since; the target's name stands in then.
            inviterName: found.inviterEmail
              ? displayName({ name: found.inviterName, email: found.inviterEmail })
              : targetName,
            companyName: targetName,
            role: found.role,
            url: `${ctx.baseUrl}/invite/${token}`,
            expiresAt: found.expiresAt,
          }),
        );
        return 'sent';
      } catch (error) {
        // Undo the claim, so the link they have works again and the next run retries. Only while
        // the link is still the reminder's: a resend meanwhile has sent them a newer one.
        await ctx.db
          .update(invitation)
          .set({ tokenHash: found.tokenHash, reminderSentAt: null })
          .where(and(eq(invitation.id, found.id), eq(invitation.tokenHash, tokenHash)));
        // eslint-disable-next-line no-console -- The job has no caller to report one failure to.
        console.error(
          `Sending the reminder for invitation ${found.id} failed; the next run tries again`,
          sendFailureOf(error),
        );
        return 'failed';
      }
    }),
  );
  return {
    sent: results.filter((result) => result === 'sent').length,
    failed: results.filter((result) => result === 'failed').length,
  };
}

export default defineRecurringJob({
  name: 'invitation-reminders',
  schedule: '10 * * * *',
  /**
   * Sends the reminders that are due. When some couldn't be sent, the run
   * counts as failed, so the failure shows (and the next run tries again).
   *
   * @param ctx - Service context.
   * @returns How many were sent and how many failed.
   */
  run: async (ctx) => {
    const { sent, failed } = await sendInvitationReminders(ctx);
    return {
      summary: { sent, failed },
      ...(failed > 0
        ? { failure: `Reminders that couldn't be sent: ${failed}; the next run tries them again` }
        : {}),
    };
  },
});
