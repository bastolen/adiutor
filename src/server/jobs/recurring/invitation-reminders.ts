/**
 * @file The hourly job that reminds people of invitations that expire soon,
 * soonest first, a group at a time until its deadline.
 */
import { and, asc, eq, exists, gt, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm';
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

/**
 * How many reminders go out at once. The run checks its deadline before each
 * group, so a long list never keeps it past the request; the rest wait for
 * the next run, which is in time: they're due 48 hours before expiry.
 */
export const REMINDER_GROUP_SIZE = 20;

/** What {@link sendInvitationReminders} did. */
interface ReminderResults {
  /** Reminders sent. */
  sent: number;
  /** Reminders that couldn't be sent: the next run tries them again. */
  failed: number;
}

/**
 * Loads the open invitations whose reminder is due (see
 * {@link sendInvitationReminders}), soonest-expiring first.
 *
 * @param ctx - Service context.
 * @returns The invitations, with what their reminders need.
 */
async function loadDueInvitations(ctx: ServiceContext) {
  // The account the invitation is addressed to, if any (`user` is joined as the inviter).
  const invitee = alias(user, 'invitee');
  // The same account, joined for its language (`invitee` is the subquery's).
  const recipient = alias(user, 'recipient');
  // Staff invitations have no company, so the deactivation check passes for them.
  return ctx.db
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
    )
    .orderBy(asc(invitation.expiresAt), asc(invitation.id));
}

/** An invitation whose reminder is due. */
type DueInvitation = Awaited<ReturnType<typeof loadDueInvitations>>[number];

/** How one reminder went: sent, couldn't be sent, or another run took it first. */
type ReminderResult = 'sent' | 'failed' | 'skipped';

/**
 * Sends one reminder with a new link, after claiming it, and undoes the
 * claim when it can't be sent.
 *
 * @param ctx - Service context.
 * @param found - The invitation.
 * @param staffName - The name the staff are shown with, for staff invitations.
 * @returns How it went.
 */
async function remind(
  ctx: ServiceContext,
  found: DueInvitation,
  staffName: string,
): Promise<ReminderResult> {
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
 * The soonest-expiring go first, {@link REMINDER_GROUP_SIZE} at a time, and
 * no new group starts after the deadline: those left stay due for the next
 * run.
 *
 * @param ctx - Service context.
 * @param deadline - When to stop starting new groups.
 * @returns How many reminders were sent, and how many failed.
 */
async function sendInvitationReminders(
  ctx: ServiceContext,
  deadline: Date,
): Promise<ReminderResults> {
  const [staffName, due] = await Promise.all([getStaffName(ctx.db), loadDueInvitations(ctx)]);
  const results: ReminderResult[] = [];
  for (
    let start = 0;
    start < due.length && Date.now() < deadline.getTime();
    start += REMINDER_GROUP_SIZE
  ) {
    // One group at a time on purpose, so the deadline is checked between them.
    // eslint-disable-next-line no-await-in-loop -- See above.
    const group = await Promise.all(
      due.slice(start, start + REMINDER_GROUP_SIZE).map((found) => remind(ctx, found, staffName)),
    );
    results.push(...group);
  }
  return {
    sent: results.filter((result) => result === 'sent').length,
    failed: results.filter((result) => result === 'failed').length,
  };
}

export default defineRecurringJob({
  name: 'invitation-reminders',
  schedule: '10 * * * *',
  /**
   * Sends the reminders that are due, until the deadline. When some couldn't
   * be sent, the run counts as failed, so the failure shows (and the next run
   * tries again).
   *
   * @param ctx - Service context.
   * @param options - The run's options.
   * @param options.deadline - When to stop starting new groups of reminders.
   * @returns How many were sent and how many failed.
   */
  run: async (ctx, { deadline }) => {
    const { sent, failed } = await sendInvitationReminders(ctx, deadline);
    return {
      summary: { sent, failed },
      ...(failed > 0
        ? { failure: `Reminders that couldn't be sent: ${failed}; the next run tries them again` }
        : {}),
    };
  },
});
