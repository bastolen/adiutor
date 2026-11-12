/**
 * @file Email telling users about a security change on their account, such
 * as a new password, two-step verification turned off, or a passkey added,
 * a changed or ended company membership, a deleted account, or that password
 * sign-in or signing in with a code was paused after too many wrong attempts,
 * or that a staff member signed in as them, in their language
 * (`emails.securityNotice`).
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailNote, EmailParagraph } from '@/components/email/email-text';
import { IMPERSONATION_MINUTES } from '@/lib/authz/impersonation';
import type { Role } from '@/lib/authz/roles';
import type { Email } from '@/lib/email';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';
import type { SecurityNoticeKind } from '@/lib/security-notice-kinds';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link SecurityNoticeEmail}.
 */
export interface SecurityNoticeEmailProps extends EmailBaseProps {
  /** What changed. */
  kind: SecurityNoticeKind;
  /** When it changed (shown in the recipient's language, in UTC). */
  when: Date;
  /** The device it was done from, in the recipient's language, e.g. "Firefox on Windows", if known. */
  device?: string | null;
  /** The IP address it was done from, if known. */
  ip?: string | null;
  /** The provider for connected/disconnected, e.g. "GitHub". */
  provider?: string;
  /** The role for staff or company role changes, named in the recipient's language. */
  role?: Role;
  /** The company's name for company role changes and removals, e.g. "Adiutor". */
  company?: string;
  /** The staff member who signed in as the recipient, e.g. "Sam Lee". */
  staffMember?: string;
  /** The name the staff are shown with to users, e.g. "Adiutor". */
  staffName?: string;
}

/** The provider, role, company and staff member a notice names, where it has them. */
interface NoticeNames {
  /** The provider's name, e.g. "GitHub". */
  provider?: string;
  /** The role, for staff and company role changes. */
  role?: Role;
  /** The company's name, e.g. "Adiutor". */
  company?: string;
  /** The staff member, for a sign-in as the recipient, e.g. "Sam Lee". */
  staffMember?: string;
  /** The name the staff are shown with to users, e.g. "Adiutor". */
  staffName?: string;
}

/**
 * The card of the Security page a notice's button goes to, by kind: the
 * switch for sign-ins by staff, after a staff member signed in as the user.
 * Other kinds go to the top of the page.
 */
const NOTICE_SECTIONS: Partial<Record<SecurityNoticeKind, string>> = {
  impersonation_started: 'staff-sign-in',
};

/**
 * The anchor a notice's button adds to the Security page's address.
 *
 * @param kind - What changed.
 * @returns `#<card>`, or nothing for the top of the page.
 */
function sectionOf(kind: SecurityNoticeKind): string {
  const section = NOTICE_SECTIONS[kind];
  return section ? `#${section}` : '';
}

/** The staff's name when none is given: the product's, as before first-run setup. */
const FALLBACK_STAFF_NAME = 'Adiutor';

/**
 * The values of a notice's arguments, in the recipient's language: the
 * names it was given, and a stand-in for any that's missing.
 *
 * @param locale - The recipient's language.
 * @param names - The provider, role, company and staff member, where the change has them.
 * @param names.provider - The provider's name; "A provider" when missing.
 * @param names.role - The role, named in the recipient's language; "a new role" when missing.
 * @param names.company - The company's name; "your company" when missing.
 * @param names.staffMember - The staff member's name; "A staff member" when missing.
 * @param names.staffName - The staff's name; "Adiutor" when missing.
 * @returns The values for `{provider}`, `{role}`, `{company}`, `{name}`, `{staff}` and
 *   `{minutes}` (how long a sign-in as someone lasts).
 */
function noticeValues(
  locale: Locale,
  { provider, role, company, staffMember, staffName }: NoticeNames,
) {
  const t = translator(locale, 'emails.securityNotice');
  return {
    provider: provider ?? t('someProvider'),
    role: role ? translator(locale, 'roles')(`${role}.label`) : t('newRole'),
    company: company ?? t('yourCompany'),
    name: staffMember ?? t('someStaffMember'),
    staff: staffName ?? FALLBACK_STAFF_NAME,
    minutes: IMPERSONATION_MINUTES,
  };
}

/**
 * The subject line for a change.
 *
 * @param locale - The recipient's language.
 * @param kind - What changed.
 * @param names - The provider, role or company, where the change has one.
 * @returns The subject.
 */
function securityNoticeSubject(
  locale: Locale,
  kind: SecurityNoticeKind,
  names: NoticeNames,
): string {
  return translator(locale, 'emails.securityNotice')(
    `${kind}.subject`,
    noticeValues(locale, names),
  );
}

/**
 * Tells the recipient what changed, when and from where, and what to do if
 * it wasn't them.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.kind - What changed.
 * @param props.when - When.
 * @param props.device - From which device.
 * @param props.ip - From which IP address.
 * @param props.provider - Provider name.
 * @param props.role - The role.
 * @param props.company - Company name.
 * @param props.staffMember - The staff member who signed in as the recipient.
 * @param props.staffName - The name the staff are shown with to users.
 * @param props.locale - The recipient's language.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function SecurityNoticeEmail({
  appUrl,
  kind,
  when,
  device = null,
  ip = null,
  provider = undefined,
  role = undefined,
  company = undefined,
  staffMember = undefined,
  staffName = undefined,
  locale,
  logoSrc = undefined,
}: SecurityNoticeEmailProps) {
  const t = translator(locale, 'emails.securityNotice');
  const values = noticeValues(locale, { provider, role, company, staffMember, staffName });
  // Nothing to review in the account of someone who can't sign in (or whose account is gone).
  const withoutAccount = kind === 'account_deactivated' || kind === 'account_deleted';
  let from: string | null = null;
  if (device && ip) {
    from = t('fromDeviceAndIp', { device, ip });
  } else if (device) {
    from = t('fromDevice', { device });
  } else if (ip) {
    from = t('fromIp', { ip });
  }
  return (
    <EmailLayout
      preview={t(`${kind}.heading`, values)}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      reason={t('reason', { kind })}
    >
      <EmailHeading>{t(`${kind}.heading`, values)}</EmailHeading>
      <EmailParagraph>{t(`${kind}.body`, values)}</EmailParagraph>
      <EmailNote>
        {t('when', { when: formatDateTime(when, locale) })}
        {from && (
          <>
            <br />
            {from}
          </>
        )}
      </EmailNote>
      {!withoutAccount && (
        <EmailButton href={`${appUrl}/account/security${sectionOf(kind)}`}>
          {t('button')}
        </EmailButton>
      )}
      <EmailParagraph>{t('ifNotYou', { kind })}</EmailParagraph>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
SecurityNoticeEmail.PreviewProps = {
  ...PREVIEW_BASE,
  kind: 'two_factor_disabled',
  when: new Date('2026-10-23T14:05:00Z'),
  device: 'Firefox on Windows',
  ip: '203.0.113.7',
} satisfies SecurityNoticeEmailProps;

/**
 * Builds a security notice email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function securityNoticeEmail(to: string, props: SecurityNoticeEmailProps): Promise<Email> {
  return renderEmail(
    to,
    securityNoticeSubject(props.locale, props.kind, {
      provider: props.provider,
      role: props.role,
      company: props.company,
      staffMember: props.staffMember,
      staffName: props.staffName,
    }),
    <SecurityNoticeEmail {...props} />,
  );
}
