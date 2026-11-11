/**
 * @file Emails users about security changes on their account (see
 * `src/emails/security-notice.tsx`), in their language. Sending never fails
 * the change itself: problems are logged.
 */
import { eq } from 'drizzle-orm';

import { user } from '@/db/schema';
import { type SecurityNoticeKind, securityNoticeEmail } from '@/emails/security-notice';
import type { Role } from '@/lib/authz/roles';
import { sendFailureOf } from '@/lib/email';
import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';
import formatIpAddress from '@/lib/request/ip-address';
import { describeUserAgent } from '@/lib/request/user-agent';

import type { ServiceContext } from '../context';
import recipientLocale from '../recipient-locale';

/** Options for {@link sendSecurityNotice}. */
export interface SecurityNoticeOptions {
  /** The provider's name, for connected/disconnected, e.g. "GitHub". */
  provider?: string;
  /** The role, for staff and company role changes (named in the recipient's language). */
  role?: Role;
  /** The company's name, for company role changes and removals, e.g. "Adiutor". */
  company?: string;
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
 * Emails a user that a security setting changed, in their language: the one
 * they saved, else Adiutor's default language, else English (US)
 * (`recipientLocale`).
 *
 * @param ctx - Service context (database, email, app URL, request).
 * @param recipient - The user, by ID or email address.
 * @param kind - What changed.
 * @param options - Provider, role and company, the language of a deleted account, and whether
 *   to show the device.
 * @param options.provider - Provider name, e.g. "GitHub".
 * @param options.role - The role, e.g. `manager`.
 * @param options.company - Company name, e.g. "Adiutor".
 * @param options.locale - A deleted account's saved language, read before the deletion.
 * @param options.showDevice - Whether to name the device and IP address, only for the
 *   recipient's own changes. Defaults to `false`.
 * @returns Whether it was sent (never throws: a failure is logged).
 */
export async function sendSecurityNotice(
  ctx: Pick<ServiceContext, 'db' | 'sendEmail' | 'baseUrl' | 'requestInfo'>,
  recipient: { userId: string } | { email: string },
  kind: SecurityNoticeKind,
  { provider, role, company, locale = null, showDevice = false }: SecurityNoticeOptions = {},
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
    const language = await recipientLocale(ctx, found?.locale ?? locale);
    const request =
      showDevice && ctx.requestInfo ? await ctx.requestInfo().catch(() => null) : null;
    const message = await securityNoticeEmail(email, {
      appUrl: ctx.baseUrl,
      locale: language,
      kind,
      when: new Date(),
      device: request?.userAgent
        ? translator(language, 'common')('device', describeUserAgent(request.userAgent))
        : null,
      ip: request?.ip ? formatIpAddress(request.ip) : null,
      provider,
      role,
      company,
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
