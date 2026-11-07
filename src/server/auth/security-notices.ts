/**
 * @file Emails users about security changes on their account (see
 * `src/emails/security-notice.tsx`). Sending never fails the change itself:
 * problems are logged.
 */
import { eq } from 'drizzle-orm';

import { user } from '@/db/schema';
import { type SecurityNoticeKind, securityNoticeEmail } from '@/emails/security-notice';
import { formatDateTime } from '@/lib/format';
import formatIpAddress from '@/lib/request/ip-address';
import { describeUserAgent } from '@/lib/request/user-agent';

import type { ServiceContext } from '../context';

/** Options for {@link sendSecurityNotice}. */
export interface SecurityNoticeOptions {
  /** The provider's name, for connected/disconnected, e.g. "GitHub". */
  provider?: string;
  /** The role's name, for staff and company role changes, e.g. "Manager". */
  role?: string;
  /** The company's name, for company role changes and removals, e.g. "Adiutor". */
  company?: string;
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
 * Emails a user that a security setting changed.
 *
 * @param ctx - Service context (database, email, app URL, request).
 * @param recipient - The user, by ID or email address.
 * @param kind - What changed.
 * @param options - Provider, role and company names and whether to show the device.
 * @param options.provider - Provider name, e.g. "GitHub".
 * @param options.role - Role name, e.g. "Manager".
 * @param options.company - Company name, e.g. "Adiutor".
 * @param options.showDevice - Whether to name the device and IP address, only for the
 *   recipient's own changes. Defaults to `false`.
 * @returns Whether it was sent (never throws: a failure is logged).
 */
export async function sendSecurityNotice(
  ctx: Pick<ServiceContext, 'db' | 'sendEmail' | 'baseUrl' | 'requestInfo'>,
  recipient: { userId: string } | { email: string },
  kind: SecurityNoticeKind,
  { provider, role, company, showDevice = false }: SecurityNoticeOptions = {},
): Promise<boolean> {
  try {
    let email = 'email' in recipient ? recipient.email : null;
    if (!email && 'userId' in recipient) {
      const [found] = await ctx.db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, recipient.userId));
      email = found?.email ?? null;
    }
    if (!email) {
      return false;
    }
    const request =
      showDevice && ctx.requestInfo ? await ctx.requestInfo().catch(() => null) : null;
    await ctx.sendEmail(
      await securityNoticeEmail(email, {
        appUrl: ctx.baseUrl,
        kind,
        when: formatDateTime(new Date()),
        device: request?.userAgent ? describeUserAgent(request.userAgent).label : null,
        ip: request?.ip ? formatIpAddress(request.ip) : null,
        provider,
        role,
        company,
      }),
    );
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console -- A failed notice must not undo the change, but should show up in the logs.
    console.error(`Sending the "${kind}" security notice failed`, error);
    return false;
  }
}
