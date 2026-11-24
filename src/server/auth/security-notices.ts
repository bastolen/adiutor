/**
 * @file Emails users about security changes on their account (see
 * `src/emails/security-notice.tsx`), in their language: queued for the next
 * tick (`queueSecurityNotice`), so a mail outage retries them, or sent
 * straight away when the account won't be there by then
 * (`sendAccountDeletedNotice`). Neither ever fails the change itself:
 * problems are logged.
 */
import type { DatabaseOrTransaction } from '@/db';
import { sendFailureOf } from '@/lib/email';
import type { Locale } from '@/lib/i18n/locales';
import type { SecurityNoticeKind } from '@/lib/security-notice-kinds';

import type { ServiceContext } from '../context';
import { queueJob, type SecurityNoticePayload, securityNoticeJob } from '../queue';
import buildSecurityNotice from './security-notice-email';

/**
 * What a queued security notice names, besides the recipient and the change:
 * the job's payload (`securityNoticeJob`), each field optional. Give the
 * change's audit event (`recordEvent` returns its ID) only for the user's own
 * change: the email names its device, IP address and time, and anyone else's
 * device must never be shown to the user.
 */
type QueuedNoticeDetails = Partial<Omit<SecurityNoticePayload, 'userId' | 'kind'>>;

/**
 * Queues a security notice for the next tick (the `security-notice` job),
 * which reads the names and addresses when it sends it, in the user's
 * language. A notice can't be queued for an account that will be gone by
 * then: see {@link sendAccountDeletedNotice}.
 *
 * @param db - Database client, or the change's transaction.
 * @param userId - The user to tell.
 * @param kind - What changed.
 * @param details - The IDs the notice names, and the change's audit event for the user's own change.
 * @returns Whether it was queued (never throws: a failure is logged).
 */
export async function queueSecurityNotice(
  db: DatabaseOrTransaction,
  userId: string,
  kind: SecurityNoticeKind,
  details: QueuedNoticeDetails = {},
): Promise<boolean> {
  try {
    await queueJob(db, securityNoticeJob, {
      userId,
      kind,
      auditEventId: null,
      providerId: null,
      role: null,
      companyId: null,
      staffUserId: null,
      ...details,
    });
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console -- A notice that can't be queued must not undo the change, but should show up in the logs; database values are left out by the log redaction.
    console.error(`Queuing the "${kind}" security notice failed`, error);
    return false;
  }
}

/**
 * Emails the address of an account that was just deleted that it's gone,
 * straight away: the account's row is gone, so the notice can't wait for the
 * queue, whose job looks the user up. It's written in the language the
 * account saved (read before the deletion), else Adiutor's default language,
 * else English (US) (`recipientLocale`), with its time in the zone the
 * account saved, else Adiutor's default zone (`recipientTimeZone`), and never
 * names a device: the account was deleted by a staff Admin.
 *
 * @param ctx - Service context (database, email, app URL).
 * @param email - The deleted account's address.
 * @param savedLocale - The language the account saved, read before the deletion.
 * @param savedTimeZone - The time zone the account saved, read before the deletion.
 * @returns Whether it was sent (never throws: a failure is logged).
 */
export async function sendAccountDeletedNotice(
  ctx: Pick<ServiceContext, 'db' | 'sendEmail' | 'baseUrl'>,
  email: string,
  savedLocale: Locale | null,
  savedTimeZone: string | null,
): Promise<boolean> {
  try {
    const message = await buildSecurityNotice(ctx, {
      email,
      savedLocale,
      savedTimeZone,
      kind: 'account_deleted',
      when: new Date(),
    });
    try {
      await ctx.sendEmail(message);
    } catch (error) {
      // eslint-disable-next-line no-console -- A failed notice must not undo the deletion, but should show up in the logs; a mail server's refusal can quote the address, so only its codes are logged.
      console.error('Sending the "account_deleted" security notice failed', sendFailureOf(error));
      return false;
    }
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console -- A failed notice must not undo the deletion, but should show up in the logs; database values are left out by the log redaction.
    console.error('Preparing the "account_deleted" security notice failed', error);
    return false;
  }
}
