/**
 * @file Telling the staff Admins when a job keeps failing: a recurring job
 * that failed `ALERT_AFTER_FAILED_RUNS` runs in a row, or queued jobs given up
 * after their last attempt. At most one email a day per job, sent straight
 * away (never through the queue, which may be what's broken), each in the
 * Admin's own language. An alert that reached nobody doesn't count as the
 * day's alert: the next failure tries again. Never throws: a failure is
 * logged.
 */
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { jobState, user } from '@/db/schema';
import { jobFailingEmail } from '@/emails/job-failing';
import { PLATFORM_ADMIN_ROLE } from '@/lib/authz/roles';
import { sendFailureOf } from '@/lib/email';

import { loadEmailBrand } from '../branding';
import type { ServiceContext } from '../context';
import recipientLocale from '../recipient-locale';

/** After how many failed runs in a row of a recurring job the staff Admins are told. */
export const ALERT_AFTER_FAILED_RUNS = 3;

/** How long after an alert about a job the next one may go out, in hours. */
const ALERT_EVERY_HOURS = 24;

/** A job that keeps failing. */
export interface FailingJob {
  /** The job's name, or the kind of queued job. */
  job: string;
  /** A recurring job that failed runs in a row, or queued jobs given up. */
  failure: 'recurring' | 'queued';
  /** How many runs in a row failed, or how many queued jobs were given up. */
  count: number;
  /** The reference of the last error it recorded, if any. */
  reference: string | null;
}

/** A job's alert, taken by one caller. */
interface AlertClaim {
  /** The moment the claim wrote as the job's last alert, which names the claim. */
  claimedAt: Date;
  /** When the last alert before it went out, to put back when this one reaches nobody. */
  previous: Date | null;
}

/**
 * Takes the job's alert, when none went out in the last
 * {@link ALERT_EVERY_HOURS} hours. Two runs failing at once can't both take
 * it. The moment is stored in whole milliseconds, so the claim can be found
 * again by it ({@link releaseAlert}).
 *
 * @param ctx - Service context (only the database is used).
 * @param job - The job's name.
 * @returns The claim, or `null` when this caller may not send the alert.
 */
async function claimAlert(
  ctx: Pick<ServiceContext, 'db'>,
  job: string,
): Promise<AlertClaim | null> {
  const before = ctx.db.$with('before').as(
    ctx.db
      .select({ id: jobState.id, previous: jobState.lastAlertAt })
      .from(jobState)
      .where(
        and(
          eq(jobState.name, job),
          or(
            isNull(jobState.lastAlertAt),
            lt(jobState.lastAlertAt, sql`now() - make_interval(hours => ${ALERT_EVERY_HOURS})`),
          ),
        ),
      )
      .for('update'),
  );
  const [claim] = await ctx.db
    .with(before)
    .update(jobState)
    .set({ lastAlertAt: sql`date_trunc('milliseconds', now())` })
    .from(before)
    .where(eq(jobState.id, before.id))
    .returning({ claimedAt: jobState.lastAlertAt, previous: before.previous });
  return claim?.claimedAt ? { claimedAt: claim.claimedAt, previous: claim.previous } : null;
}

/**
 * Gives a claim back, so the next failure may send the alert: the job's last
 * alert is again the one from before the claim. Only while the stored moment
 * is still this claim's, so a newer claim is never overwritten.
 *
 * @param ctx - Service context (only the database is used).
 * @param job - The job's name.
 * @param claim - The claim to give back.
 */
async function releaseAlert(
  ctx: Pick<ServiceContext, 'db'>,
  job: string,
  claim: AlertClaim,
): Promise<void> {
  await ctx.db
    .update(jobState)
    .set({ lastAlertAt: claim.previous })
    .where(and(eq(jobState.name, job), eq(jobState.lastAlertAt, claim.claimedAt)));
}

/**
 * Emails every active staff Admin that a job keeps failing, unless they were
 * told about it in the last day. When there are Admins and not one email
 * could be sent (a mail server that's down is the likeliest reason a job
 * fails), the day's alert is given back, so the next failure tells them.
 *
 * @param ctx - Service context (database, email, app URL).
 * @param failing - The job and what went wrong.
 * @returns How many Admins were emailed.
 */
export async function alertStaffAdmins(
  ctx: Pick<ServiceContext, 'db' | 'sendEmail' | 'baseUrl'>,
  failing: FailingJob,
): Promise<number> {
  try {
    const claim = await claimAlert(ctx, failing.job);
    if (!claim) {
      return 0;
    }
    const admins = await ctx.db
      .select({ id: user.id, email: user.email, locale: user.locale })
      .from(user)
      .where(and(eq(user.platformRole, PLATFORM_ADMIN_ROLE), isNull(user.deactivatedAt)));
    const brand = await loadEmailBrand(ctx.db);
    const url = new URL('/admin/logs/errors', ctx.baseUrl);
    if (failing.reference) {
      url.searchParams.set('q', failing.reference);
    }
    const sent = await Promise.all(
      admins.map(async (admin) => {
        try {
          await ctx.sendEmail(
            await jobFailingEmail(admin.email, {
              appUrl: ctx.baseUrl,
              brand,
              locale: await recipientLocale(ctx, admin.locale),
              job: failing.job,
              failure: failing.failure,
              count: failing.count,
              reference: failing.reference,
              url: url.toString(),
            }),
          );
          return true;
        } catch (error) {
          // eslint-disable-next-line no-console -- The alert is about a failure already; the log is the fallback.
          console.error(
            `Telling staff Admin ${admin.id} that job ${failing.job} keeps failing failed`,
            sendFailureOf(error),
          );
          return false;
        }
      }),
    );
    const emailed = sent.filter(Boolean).length;
    if (admins.length > 0 && emailed === 0) {
      await releaseAlert(ctx, failing.job, claim);
    }
    return emailed;
  } catch (error) {
    // eslint-disable-next-line no-console -- As above; database values are left out by the log redaction.
    console.error(`Telling the staff Admins that job ${failing.job} keeps failing failed`, error);
    return 0;
  }
}
