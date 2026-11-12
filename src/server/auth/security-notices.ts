/**
 * @file Emails users about security changes on their account (see
 * `src/emails/security-notice.tsx`), in their language: queued for the next
 * tick (`queueSecurityNotice`), so a mail outage retries them, or sent
 * straight away when the account won't be there by then (`sendSecurityNotice`,
 * for a deleted account). Neither ever fails the change itself: problems are
 * logged.
 */
import { eq } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { user } from '@/db/schema';
import type { Role } from '@/lib/authz/roles';
import { sendFailureOf } from '@/lib/email';
import type { Locale } from '@/lib/i18n/locales';
import type { SecurityNoticeKind } from '@/lib/security-notice-kinds';

import type { ServiceContext } from '../context';
import { queueJob, securityNoticeJob } from '../queue';
import buildSecurityNotice from './security-notice-email';

/** What a queued security notice names, besides the recipient and the change. */
export interface QueuedNoticeDetails {
  /**
   * The change's audit event (`recordEvent` returns its ID), only for the
   * user's own change: the email names its device, IP address and time.
   * Anyone else's device must never be shown to the user.
   */
  auditEventId?: string | null;
  /** The provider, for connected/disconnected, e.g. `github`. */
  providerId?: string | null;
  /** The role, for staff and company role changes. */
  role?: Role | null;
  /** The company, for company role changes and removals. */
  companyId?: string | null;
  /** The staff member who signed in as the user. */
  staffUserId?: string | null;
}

/**
 * Queues a security notice for the next tick (the `security-notice` job),
 * which reads the names and addresses when it sends it, in the user's
 * language. A notice can't be queued for an account that will be gone by
 * then: send that one with {@link sendSecurityNotice}.
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
      auditEventId: details.auditEventId ?? null,
      providerId: details.providerId ?? null,
      role: details.role ?? null,
      companyId: details.companyId ?? null,
      staffUserId: details.staffUserId ?? null,
    });
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console -- A notice that can't be queued must not undo the change, but should show up in the logs; database values are left out by the log redaction.
    console.error(`Queuing the "${kind}" security notice failed`, error);
    return false;
  }
}

/** Options for {@link sendSecurityNotice}. */
export interface SecurityNoticeOptions {
  /** The provider's name, for connected/disconnected, e.g. "GitHub". */
  provider?: string;
  /** The role, for staff and company role changes (named in the recipient's language). */
  role?: Role;
  /** The company's name, for company role changes and removals, e.g. "Adiutor". */
  company?: string;
  /** The staff member's name, for a sign-in as the recipient, e.g. "Sam Lee". */
  staffMember?: string;
  /** The name the staff are shown with to users (`getStaffName`), e.g. "Adiutor". */
  staffName?: string;
  /**
   * The recipient's saved language when it can't be looked up any more: a
   * deleted account's, read before the deletion. An account that still
   * exists is looked up instead.
   */
  locale?: Locale | null;
  /**
   * Whether to say which device and IP address made the change. Off by
   * default: turn it on only when the recipient made the change themselves.
   * For anything else (an Admin's change, a role someone gave them, wrong
   * passwords someone typed) it would be another person's device, which
   * users must never see.
   */
  showDevice?: boolean;
}

/**
 * Emails a user straight away that a security setting changed, in their
 * language: the one they saved, else Adiutor's default language, else
 * English (US) (`recipientLocale`). Only for a notice that can't wait for the
 * queue, such as one to a deleted account's address; queue the others with
 * {@link queueSecurityNotice}.
 *
 * @param ctx - Service context (database, email, app URL, request).
 * @param recipient - The user, by ID or email address.
 * @param kind - What changed.
 * @param options - Provider, role and company, the language of a deleted account, and whether
 *   to show the device.
 * @param options.provider - Provider name, e.g. "GitHub".
 * @param options.role - The role, e.g. `manager`.
 * @param options.company - Company name, e.g. "Adiutor".
 * @param options.staffMember - The staff member who signed in as the recipient, e.g. "Sam Lee".
 * @param options.staffName - The name the staff are shown with to users, e.g. "Adiutor".
 * @param options.locale - A deleted account's saved language, read before the deletion.
 * @param options.showDevice - Whether to name the device and IP address, only for the
 *   recipient's own changes. Defaults to `false`.
 * @returns Whether it was sent (never throws: a failure is logged).
 */
export async function sendSecurityNotice(
  ctx: Pick<ServiceContext, 'db' | 'sendEmail' | 'baseUrl' | 'requestInfo'>,
  recipient: { userId: string } | { email: string },
  kind: SecurityNoticeKind,
  {
    provider,
    role,
    company,
    staffMember,
    staffName,
    locale = null,
    showDevice = false,
  }: SecurityNoticeOptions = {},
): Promise<boolean> {
  try {
    const [found] = await ctx.db
      .select({ email: user.email, locale: user.locale })
      .from(user)
      .where(
        'userId' in recipient ? eq(user.id, recipient.userId) : eq(user.email, recipient.email),
      );
    // A deleted account's address is given: it has no row any more.
    const email = 'email' in recipient ? recipient.email : (found?.email ?? null);
    if (!email) {
      return false;
    }
    const request =
      showDevice && ctx.requestInfo ? await ctx.requestInfo().catch(() => null) : null;
    const message = await buildSecurityNotice(ctx, {
      email,
      savedLocale: found?.locale ?? locale,
      kind,
      when: new Date(),
      origin: request,
      provider,
      role,
      company,
      staffMember,
      staffName,
    });
    try {
      await ctx.sendEmail(message);
    } catch (error) {
      // eslint-disable-next-line no-console -- A failed notice must not undo the change, but should show up in the logs; a mail server's refusal can quote the address, so only its codes are logged.
      console.error(`Sending the "${kind}" security notice failed`, sendFailureOf(error));
      return false;
    }
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console -- A failed notice must not undo the change, but should show up in the logs; database values are left out by the log redaction.
    console.error(`Preparing the "${kind}" security notice failed`, error);
    return false;
  }
}
