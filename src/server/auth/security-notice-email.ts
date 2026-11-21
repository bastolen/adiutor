/**
 * @file Building a security notice for a recipient (`src/emails/security-notice.tsx`),
 * in their language and time zone, with the device and IP address of the change when it
 * was their own. Shared by the notice sent straight away (`sendAccountDeletedNotice`)
 * and the queued one (the `security-notice` job).
 */
import { securityNoticeEmail } from '@/emails/security-notice';
import type { Role } from '@/lib/authz/roles';
import type { Email } from '@/lib/email';
import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';
import { describeIpAddress } from '@/lib/request/ip-address';
import { describeUserAgent } from '@/lib/request/user-agent';
import type { SecurityNoticeKind } from '@/lib/security-notice-kinds';

import type { ServiceContext } from '../context';
import recipientLocale from '../recipient-locale';
import recipientTimeZone from '../recipient-time-zone';

/** What a security notice says, and to whom. */
export interface SecurityNoticeContent {
  /** The recipient's address. */
  email: string;
  /** The recipient's saved language, if any (else Adiutor's default, else English). */
  savedLocale: string | null;
  /** The recipient's saved time zone, if any (else Adiutor's default). */
  savedTimeZone: string | null;
  /** What changed. */
  kind: SecurityNoticeKind;
  /** When it changed. */
  when: Date;
  /**
   * Where the change came from, only for the recipient's own change: anyone
   * else's device must never be shown to them.
   */
  origin?: { ip: string | null; userAgent: string | null } | null;
  /** The provider's name, for connected/disconnected, e.g. "GitHub". */
  provider?: string | undefined;
  /** The role, for staff and company role changes. */
  role?: Role | undefined;
  /** The company's name, for company role changes and removals. */
  company?: string | undefined;
  /** The staff member who signed in as the recipient. */
  staffMember?: string | undefined;
  /** The name the staff are shown with to users. */
  staffName?: string | undefined;
}

/**
 * Builds a security notice in the recipient's language and time zone
 * (`recipientLocale`, `recipientTimeZone`).
 *
 * @param ctx - Service context (database, for Adiutor's default language and zone, and the app URL).
 * @param content - What it says, and to whom.
 * @param content.email - The recipient's address.
 * @param content.savedLocale - The recipient's saved language, if any.
 * @param content.savedTimeZone - The recipient's saved time zone, if any.
 * @param content.kind - What changed.
 * @param content.when - When it changed.
 * @param content.origin - Where the change came from, only for the recipient's own change.
 * @returns The email, ready to send.
 */
export default async function buildSecurityNotice(
  ctx: Pick<ServiceContext, 'db' | 'baseUrl'>,
  { email, savedLocale, savedTimeZone, kind, when, origin = null, ...names }: SecurityNoticeContent,
): Promise<Email> {
  const [language, timeZone]: [Locale, string] = await Promise.all([
    recipientLocale(ctx, savedLocale),
    recipientTimeZone(ctx, savedTimeZone),
  ]);
  return securityNoticeEmail(email, {
    appUrl: ctx.baseUrl,
    locale: language,
    kind,
    when,
    timeZone,
    device: origin?.userAgent
      ? translator(language, 'common')('device', describeUserAgent(origin.userAgent))
      : null,
    ip: origin?.ip
      ? translator(language, 'common')('ipAddress', describeIpAddress(origin.ip))
      : null,
    ...names,
  });
}
