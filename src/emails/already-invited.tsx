/**
 * @file Email sent instead of a confirmation when someone opens an invite
 * link for a company (or the staff) while their address already has an open
 * invitation there, so the screen can say "sent" without revealing anything.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph } from '@/components/email/email-text';
import type { Email } from '@/lib/email';

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
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.companyName - The company, or the staff's name.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function AlreadyInvitedEmail({
  appUrl,
  companyName,
  logoSrc = undefined,
}: AlreadyInvitedEmailProps) {
  return (
    <EmailLayout
      preview={`Use your earlier invitation to ${companyName}`}
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason={`You're receiving this because someone used an invite link for ${companyName} with this email address. If that wasn't you, you can ignore this email.`}
    >
      <EmailHeading>You already have an invitation</EmailHeading>
      <EmailParagraph>
        You opened an invite link for {companyName} on Adiutor, but this email address already has
        an open invitation there. Use the invitation email you received earlier to join.
      </EmailParagraph>
      <EmailParagraph>
        If that invitation has expired, ask whoever invited you to send you a new one.
      </EmailParagraph>
      <EmailButton href={`${appUrl}/auth`}>Go to Adiutor</EmailButton>
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
    `You already have an invitation to ${props.companyName} on Adiutor`,
    <AlreadyInvitedEmail {...props} />,
  );
}
