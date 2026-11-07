/**
 * @file Email telling users about a security change on their account, such
 * as a new password, two-step verification turned off, or a passkey added,
 * a changed or ended company membership, a deleted account, or that password
 * sign-in or signing in with a code was paused after too many wrong attempts.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailNote, EmailParagraph } from '@/components/email/email-text';
import type { Email } from '@/lib/email';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/** The changes users are told about. */
export const SECURITY_NOTICE_KINDS = [
  'password_changed',
  'password_added',
  'password_reset',
  'two_factor_enabled',
  'two_factor_disabled',
  'backup_codes_regenerated',
  'passkey_added',
  'passkey_removed',
  'provider_connected',
  'provider_disconnected',
  'mfa_reset',
  'signed_out_everywhere',
  'account_deactivated',
  'account_reactivated',
  'staff_role_granted',
  'staff_role_changed',
  'staff_role_removed',
  'password_sign_in_paused',
  'company_role_changed',
  'removed_from_company',
  'account_deleted',
  'two_factor_locked',
] as const;

/** One of {@link SECURITY_NOTICE_KINDS}. */
export type SecurityNoticeKind = (typeof SECURITY_NOTICE_KINDS)[number];

/** The wording of one notice. */
interface Notice {
  /** Subject line. */
  subject: string;
  /** Heading, also the inbox preview. */
  heading: string;
  /** What happened. */
  body: string;
  /** What to do if it wasn't them; defaults to resetting the password. */
  ifNotYou?: string;
  /** Why they get this email (the footer); defaults to "a security setting changed". */
  reason?: string;
}

/**
 * Subject and wording per change. `{provider}` is replaced by e.g. "GitHub",
 * `{role}` by a role's name and `{company}` by a company's name.
 */
const NOTICES: Record<SecurityNoticeKind, Notice> = {
  password_changed: {
    subject: 'Your Adiutor password was changed',
    heading: 'Your password was changed',
    body: 'The password of your Adiutor account was changed, and you were signed out on your other devices.',
  },
  password_added: {
    subject: 'A password was added to your Adiutor account',
    heading: 'A password was added',
    body: 'You can now also sign in to Adiutor with your email address and this password.',
  },
  password_reset: {
    subject: 'Your Adiutor password was reset',
    heading: 'Your password was reset',
    body: 'The password of your Adiutor account was reset with a link sent to this address, and you were signed out everywhere.',
  },
  two_factor_enabled: {
    subject: 'Two-step verification is on for your Adiutor account',
    heading: 'Two-step verification is on',
    body: 'Signing in to Adiutor with your password now also needs a code.',
  },
  two_factor_disabled: {
    subject: 'Two-step verification was turned off on your Adiutor account',
    heading: 'Two-step verification was turned off',
    body: 'Signing in to Adiutor with your password no longer needs a code.',
  },
  backup_codes_regenerated: {
    subject: 'New backup codes for your Adiutor account',
    heading: 'You have new backup codes',
    body: 'New backup codes were created for your Adiutor account. Your old backup codes no longer work.',
  },
  passkey_added: {
    subject: 'A passkey was added to your Adiutor account',
    heading: 'A passkey was added',
    body: 'A new passkey can now be used to sign in to your Adiutor account.',
  },
  passkey_removed: {
    subject: 'A passkey was removed from your Adiutor account',
    heading: 'A passkey was removed',
    body: 'One of your passkeys can no longer be used to sign in to Adiutor.',
  },
  provider_connected: {
    subject: '{provider} was connected to your Adiutor account',
    heading: '{provider} was connected',
    body: 'You can now sign in to Adiutor with your {provider} account.',
  },
  provider_disconnected: {
    subject: '{provider} was disconnected from your Adiutor account',
    heading: '{provider} was disconnected',
    body: 'Your {provider} account can no longer be used to sign in to Adiutor.',
  },
  mfa_reset: {
    subject: 'Your Adiutor two-step verification was reset',
    heading: 'Your two-step verification was reset',
    body: 'An administrator turned off two-step verification on your Adiutor account, usually because a phone was lost. Any GitHub or Google accounts connected to your Adiutor account were disconnected, and you were signed out everywhere. Set up two-step verification again on your Security page.',
  },
  signed_out_everywhere: {
    subject: 'You were signed out of Adiutor',
    heading: 'You were signed out everywhere',
    body: 'An administrator signed your Adiutor account out on every device. Sign in again to continue.',
  },
  account_deactivated: {
    subject: 'Your Adiutor account was deactivated',
    heading: 'Your account was deactivated',
    body: "Your Adiutor account was deactivated, and you can't sign in until an administrator reactivates it.",
    ifNotYou: "If you didn't expect this, contact your administrator.",
  },
  account_reactivated: {
    subject: 'Your Adiutor account was reactivated',
    heading: 'Your account was reactivated',
    body: 'An administrator reactivated your Adiutor account. You can sign in again.',
  },
  staff_role_granted: {
    subject: 'You now have staff access to Adiutor',
    heading: 'You now have staff access',
    body: 'An administrator made you staff on Adiutor, as {role}. You can now work with every company.',
  },
  staff_role_changed: {
    subject: 'Your Adiutor staff role changed',
    heading: 'Your staff role changed',
    body: 'An administrator changed your staff role on Adiutor to {role}.',
  },
  staff_role_removed: {
    subject: 'Your Adiutor staff access was removed',
    heading: 'Your staff access was removed',
    body: 'An administrator removed your staff access on Adiutor. Your account and any company memberships stay.',
  },
  // Who typed the passwords isn't shown: it may be someone else, whose IP address and browser are
  // only for administrators (in the audit log).
  password_sign_in_paused: {
    subject: 'Password sign-in to your Adiutor account is paused',
    heading: 'Password sign-in is paused',
    body: "A wrong password was entered for your Adiutor account too many times, so signing in with a password is paused for a while. No one signed in: the password wasn't accepted. You can still sign in with an email link or a passkey, and resetting your password lifts the pause.",
    ifNotYou:
      "If this wasn't you, someone may be guessing your password. Make sure it's one you don't use anywhere else, or add a passkey.",
    reason:
      "You're receiving this because of failed sign-in attempts on your Adiutor account. We send it at most once a day.",
  },
  company_role_changed: {
    subject: 'Your role in {company} on Adiutor changed',
    heading: 'Your role in {company} changed',
    body: 'Your role in {company} on Adiutor was changed to {role}.',
    ifNotYou: "If you didn't expect this, contact your administrator.",
  },
  removed_from_company: {
    subject: 'You were removed from {company} on Adiutor',
    heading: 'You were removed from {company}',
    body: 'You were removed from {company} on Adiutor, so you can no longer open it. Your account and your other companies stay.',
    ifNotYou: "If you didn't expect this, contact your administrator.",
  },
  account_deleted: {
    subject: 'Your Adiutor account was deleted',
    heading: 'Your account was deleted',
    body: "An administrator deleted your Adiutor account, with its sign-in methods and company memberships. You can't sign in with it any more.",
    ifNotYou: "If you didn't expect this, contact your administrator.",
    reason:
      "You're receiving this because your Adiutor account was deleted. We send it once, to the address the account had.",
  },
  // Who typed the codes isn't shown: it may be someone else, whose IP address and browser are
  // only for administrators (in the audit log).
  two_factor_locked: {
    subject: 'Signing in to your Adiutor account with a code is paused',
    heading: 'Signing in with a code is paused',
    body: "A wrong code was entered for your Adiutor account's two-step verification too many times, so signing in with a code is paused for 15 minutes. No one signed in: the codes weren't accepted.",
    ifNotYou:
      "If this wasn't you, someone may know your password. Change it right away, and make sure it's one you don't use anywhere else.",
    reason:
      "You're receiving this because of failed sign-in attempts on your Adiutor account. We send it once each time signing in with a code is paused.",
  },
};

/**
 * Props for {@link SecurityNoticeEmail}.
 */
export interface SecurityNoticeEmailProps extends EmailBaseProps {
  /** What changed. */
  kind: SecurityNoticeKind;
  /** When it changed, already formatted, e.g. "23 Oct 2026, 14:05 UTC". */
  when: string;
  /** The device it was done from, e.g. "Firefox on Windows", if known. */
  device?: string | null;
  /** The IP address it was done from, if known. */
  ip?: string | null;
  /** The provider for connected/disconnected, e.g. "GitHub". */
  provider?: string;
  /** The role for staff or company role changes, e.g. "Manager" or "Client". */
  role?: string;
  /** The company's name for company role changes and removals, e.g. "Adiutor". */
  company?: string;
}

/** Values for the placeholders in the notices. */
interface NoticeValues {
  /** The provider's name, for `{provider}`. */
  provider?: string;
  /** The role, for `{role}`. */
  role?: string;
  /** The company's name, for `{company}`. */
  company?: string;
}

/**
 * Fills in the placeholders.
 *
 * @param text - Text with `{provider}`, `{role}` or `{company}`.
 * @param values - The values.
 * @param values.provider - The provider's name; defaults to "A provider".
 * @param values.role - The role's name; defaults to "a new role".
 * @param values.company - The company's name; defaults to "your company".
 * @returns The text.
 */
function fill(
  text: string,
  { provider = 'A provider', role = 'a new role', company = 'your company' }: NoticeValues,
): string {
  return text
    .replaceAll('{provider}', provider)
    .replaceAll('{role}', role)
    .replaceAll('{company}', company);
}

/**
 * The subject line for a change.
 *
 * @param kind - What changed.
 * @param values - The provider, role or company, where the change has one.
 * @returns The subject.
 */
function securityNoticeSubject(kind: SecurityNoticeKind, values: NoticeValues = {}): string {
  return fill(NOTICES[kind].subject, values);
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
 * @param props.role - Role name.
 * @param props.company - Company name.
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
  logoSrc = undefined,
}: SecurityNoticeEmailProps) {
  const values = { provider, role, company };
  const notice = NOTICES[kind];
  // Nothing to review in the account of someone who can't sign in (or whose account is gone).
  const withoutAccount = kind === 'account_deactivated' || kind === 'account_deleted';
  const from = [device, ip].filter(Boolean).join(', ');
  return (
    <EmailLayout
      preview={fill(notice.heading, values)}
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason={
        notice.reason ??
        "You're receiving this because a security setting changed on your Adiutor account. We always send these, so you know about every change."
      }
    >
      <EmailHeading>{fill(notice.heading, values)}</EmailHeading>
      <EmailParagraph>{fill(notice.body, values)}</EmailParagraph>
      <EmailNote>
        When: {when}
        {from && (
          <>
            <br />
            From: {from}
          </>
        )}
      </EmailNote>
      {!withoutAccount && (
        <EmailButton href={`${appUrl}/account/security`}>Review your security settings</EmailButton>
      )}
      <EmailParagraph>
        {notice.ifNotYou ??
          "If this wasn't you, reset your password right away and contact your administrator."}
      </EmailParagraph>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
SecurityNoticeEmail.PreviewProps = {
  ...PREVIEW_BASE,
  kind: 'two_factor_disabled',
  when: '23 Oct 2026, 14:05 UTC',
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
    securityNoticeSubject(props.kind, {
      provider: props.provider,
      role: props.role,
      company: props.company,
    }),
    <SecurityNoticeEmail {...props} />,
  );
}
