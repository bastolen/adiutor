/**
 * @file Reminder that an invitation expires soon, with a fresh link.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import {
  EmailHeading,
  EmailNote,
  EmailParagraph,
  LinkFallback,
} from '@/components/email/email-text';
import { emailColours, emailName } from '@/components/email/theme';
import type { Role } from '@/lib/authz/roles';
import type { Email } from '@/lib/email';
import { formatDateTime } from '@/lib/format';
import translator from '@/lib/i18n/translator';

import { type EmailBaseProps, type InviteTarget, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link InvitationReminderEmail}.
 */
export interface InvitationReminderEmailProps extends EmailBaseProps {
  /**
   * Name (or email) of the person who sent the invitation, or `null` when
   * nobody did or their account is gone: the email then says they're invited
   * without naming anyone, never naming the staff or the company in their
   * place.
   */
  inviterName: string | null;
  /** Name of the company, or the staff's for an invitation to the staff. */
  companyName: string;
  /**
   * Whether it's to a company or to the staff, whose name `companyName` then
   * holds: the email names it once (`InviteTarget`).
   */
  target: InviteTarget;
  /** The role they'll get. */
  role: Role;
  /** Link to accept the invitation (replaces the earlier one). */
  url: string;
  /** When the invitation expires (shown in the recipient's language and zone, naming the zone). */
  expiresAt: Date;
  /**
   * The recipient's time zone, e.g. `Europe/Amsterdam`: their own when they
   * have an account with one, else the sender's, else Adiutor's default
   * (`recipientTimeZone`).
   */
  timeZone: string;
}

/**
 * Reminds the recipient of an invitation they haven't accepted yet, before
 * it expires. The link is new; the one in the first email stops working.
 */
export default function InvitationReminderEmail({
  appUrl,
  inviterName,
  companyName,
  target,
  role,
  url,
  expiresAt,
  timeZone,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: InvitationReminderEmailProps) {
  const colours = emailColours(brand);
  const t = translator(locale, 'emails.invitationReminder');
  const values = {
    // Who sent it, or `none`: the messages then name nobody in their place.
    ...(inviterName === null ? { by: 'none' } : { by: 'person', inviter: inviterName }),
    company: companyName,
    target,
    staff: emailName(brand),
    role: translator(locale, 'roles')(`${role}.label`),
    expires: formatDateTime(expiresAt, locale, timeZone, { zoneName: true }),
  };
  return (
    <EmailLayout
      preview={t('preview', values)}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      brand={brand}
      reason={t('reason', values)}
    >
      <EmailHeading colours={colours}>{t('heading')}</EmailHeading>
      <EmailParagraph colours={colours}>{t('body', values)}</EmailParagraph>
      <EmailButton colours={colours} href={url}>
        {t('button')}
      </EmailButton>
      <EmailNote colours={colours}>{t('note')}</EmailNote>
      <LinkFallback colours={colours} url={url} locale={locale} />
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
InvitationReminderEmail.PreviewProps = {
  ...PREVIEW_BASE,
  inviterName: 'Alex Doe',
  companyName: 'Adiutor',
  target: 'company',
  role: 'client',
  url: 'https://adiutor.dev/invite/example',
  expiresAt: new Date('2026-10-25T14:05:00Z'),
  timeZone: 'Europe/Amsterdam',
} satisfies InvitationReminderEmailProps;

/**
 * Builds the invitation reminder email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function invitationReminderEmail(
  to: string,
  props: InvitationReminderEmailProps,
): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.invitationReminder')('subject', {
      company: props.companyName,
      target: props.target,
      staff: emailName(props.brand),
    }),
    <InvitationReminderEmail {...props} />,
  );
}
