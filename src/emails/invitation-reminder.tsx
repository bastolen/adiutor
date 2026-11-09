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
import type { Role } from '@/lib/authz/roles';
import type { Email } from '@/lib/email';
import { formatDateTime } from '@/lib/format';
import translator from '@/lib/i18n/translator';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link InvitationReminderEmail}.
 */
export interface InvitationReminderEmailProps extends EmailBaseProps {
  /** Name (or email) of the person who sent the invitation, or the company's name. */
  inviterName: string;
  /** Name of the company. */
  companyName: string;
  /** The role they'll get. */
  role: Role;
  /** Link to accept the invitation (replaces the earlier one). */
  url: string;
  /** When the invitation expires (shown in the recipient's language, in UTC). */
  expiresAt: Date;
}

/**
 * Reminds the recipient of an invitation they haven't accepted yet, before
 * it expires. The link is new; the one in the first email stops working.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.inviterName - Who sent the invitation.
 * @param props.companyName - The company.
 * @param props.role - The role.
 * @param props.url - Accept link.
 * @param props.expiresAt - When it expires.
 * @param props.locale - The recipient's language.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function InvitationReminderEmail({
  appUrl,
  inviterName,
  companyName,
  role,
  url,
  expiresAt,
  locale,
  logoSrc = undefined,
}: InvitationReminderEmailProps) {
  const t = translator(locale, 'emails.invitationReminder');
  const values = {
    inviter: inviterName,
    company: companyName,
    role: translator(locale, 'roles')(`${role}.label`),
    expires: formatDateTime(expiresAt, locale),
  };
  return (
    <EmailLayout
      preview={t('preview', values)}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      reason={t('reason', values)}
    >
      <EmailHeading>{t('heading')}</EmailHeading>
      <EmailParagraph>{t('body', values)}</EmailParagraph>
      <EmailButton href={url}>{t('button')}</EmailButton>
      <EmailNote>{t('note')}</EmailNote>
      <LinkFallback url={url} locale={locale} />
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
InvitationReminderEmail.PreviewProps = {
  ...PREVIEW_BASE,
  inviterName: 'Alex Doe',
  companyName: 'Adiutor',
  role: 'client',
  url: 'https://adiutor.dev/invite/example',
  expiresAt: new Date('2026-10-25T14:05:00Z'),
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
    }),
    <InvitationReminderEmail {...props} />,
  );
}
