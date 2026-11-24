/**
 * @file Email sent instead of a confirmation when someone opens an invite
 * link for a company (or the staff) while their address already has an open
 * invitation there, so the screen can say "sent" without revealing anything.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph } from '@/components/email/email-text';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link AlreadyInvitedEmail}.
 */
export interface AlreadyInvitedEmailProps extends EmailBaseProps {
  /** Name of the company, or the staff's name when the invitation is for the staff. */
  companyName: string;
}

/**
 * Tells the recipient to use the invitation email they already received, and
 * to ask whoever invited them for a new one if it expired. The button opens
 * the sign-in page; it doesn't carry an invitation, so a stranger who typed
 * the address can't use this email to join.
 *
 * @returns The email.
 */
export default function AlreadyInvitedEmail({
  appUrl,
  companyName,
  locale,
  logoSrc = undefined,
}: AlreadyInvitedEmailProps) {
  const t = translator(locale, 'emails.alreadyInvited');
  const values = { company: companyName };
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
      <EmailParagraph>{t('expired')}</EmailParagraph>
      <EmailButton href={`${appUrl}/auth`}>{t('button')}</EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
AlreadyInvitedEmail.PreviewProps = {
  ...PREVIEW_BASE,
  companyName: 'Adiutor',
} satisfies AlreadyInvitedEmailProps;

/**
 * Builds the "already invited" email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function alreadyInvitedEmail(to: string, props: AlreadyInvitedEmailProps): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.alreadyInvited')('subject', { company: props.companyName }),
    <AlreadyInvitedEmail {...props} />,
  );
}
