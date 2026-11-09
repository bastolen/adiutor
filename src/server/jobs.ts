/**
 * @file Background jobs, run hourly by `pnpm jobs:run` (see
 * `scripts/run-jobs.ts`): cleaning up expired data and reminding people of
 * invitations that expire soon. Every job is safe to run again.
 */
import { and, eq, exists, gt, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  account,
  appError,
  auditEvent,
  company,
  invitation,
  membership,
  rateLimit,
  rateLimitBucket,
  session,
  signInError,
  user,
  verification,
} from '@/db/schema';
import { invitationReminderEmail } from '@/emails/invitation-reminder';
import displayName from '@/lib/display-name';
import { isLocale } from '@/lib/i18n/locales';
import { generateToken, hashToken } from '@/lib/sign-in/tokens';

import { APP_ERROR_RETENTION_DAYS } from './app-errors';
import { SIGN_IN_ERROR_RETENTION_DAYS } from './auth/sign-in-errors';
import type { ServiceContext } from './context';
import getStaffName from './people/staff-name';
import sendFailureOf from './send-failure';

/** How long audit events are kept. */
const AUDIT_RETENTION_DAYS = 365;

/** How long before an invitation expires its reminder is sent. */
const REMINDER_BEFORE_HOURS = 48;

/** What {@link cleanUp} removed. */
export interface CleanUpResult {
  /** Expired verification values (sign-in links, codes, reset tokens). */
  verifications: number;
  /** Expired sessions. */
  sessions: number;
  /** Finished rate-limit windows (the app's and Better Auth's). */
  rateLimits: number;
  /** Audit events older than {@link AUDIT_RETENTION_DAYS} days. */
  auditEvents: number;
  /** Sign-in errors older than `SIGN_IN_ERROR_RETENTION_DAYS` days. */
  signInErrors: number;
  /** Other errors in the app older than `APP_ERROR_RETENTION_DAYS` days. */
  appErrors: number;
  /** GitHub or Google accounts whose OAuth tokens a failed request left behind. */
  providerTokens: number;
}

/**
 * Deletes data nobody can use any more. Invitations and invite links are
 * kept as history; their tokens are stored hashed and stop working when they
 * expire. OAuth tokens are only needed during the request that stored them
 * (see `withoutKeptTokens` in `auth-events/provider-accounts.ts`); any still there after ten
 * minutes are cleared.
 *
 * @param ctx - Service context (only the database is used).
 * @returns How many rows were removed per kind.
 */
export async function cleanUp(ctx: Pick<ServiceContext, 'db'>): Promise<CleanUpResult> {
  const { db } = ctx;
  const [
    verifications,
    sessions,
    buckets,
    betterAuthLimits,
    auditEvents,
    signInErrors,
    appErrors,
    providerTokens,
  ] = await Promise.all([
    db
      .delete(verification)
      .where(lt(verification.expiresAt, sql`now()`))
      .returning({ id: verification.id }),
    db
      .delete(session)
      .where(lt(session.expiresAt, sql`now()`))
      .returning({ id: session.id }),
    db
      .delete(rateLimitBucket)
      .where(lt(rateLimitBucket.resetAt, sql`now()`))
      .returning({ id: rateLimitBucket.id }),
    // Better Auth's windows are at most minutes long; a day without requests means it's done.
    db
      .delete(rateLimit)
      .where(lt(rateLimit.lastRequest, Date.now() - 24 * 60 * 60 * 1000))
      .returning({ id: rateLimit.id }),
    db
      .delete(auditEvent)
      .where(lt(auditEvent.at, sql`now() - make_interval(days => ${AUDIT_RETENTION_DAYS})`))
      .returning({ id: auditEvent.id }),
    db
      .delete(signInError)
      .where(
        lt(
          signInError.createdAt,
          sql`now() - make_interval(days => ${SIGN_IN_ERROR_RETENTION_DAYS})`,
        ),
      )
      .returning({ id: signInError.id }),
    db
      .delete(appError)
      .where(
        lt(appError.createdAt, sql`now() - make_interval(days => ${APP_ERROR_RETENTION_DAYS})`),
      )
      .returning({ id: appError.id }),
    db
      .update(account)
      .set({ accessToken: null, refreshToken: null, idToken: null })
      .where(
        and(
          or(
            isNotNull(account.accessToken),
            isNotNull(account.refreshToken),
            isNotNull(account.idToken),
          ),
          lt(account.updatedAt, sql`now() - interval '10 minutes'`),
        ),
      )
      .returning({ id: account.id }),
  ]);
  return {
    verifications: verifications.length,
    sessions: sessions.length,
    rateLimits: buckets.length + betterAuthLimits.length,
    auditEvents: auditEvents.length,
    signInErrors: signInErrors.length,
    appErrors: appErrors.length,
    providerTokens: providerTokens.length,
  };
}

/** What {@link sendInvitationReminders} did. */
export interface ReminderResults {
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
export async function sendInvitationReminders(ctx: ServiceContext): Promise<ReminderResults> {
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
