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
import { ROLE_LABELS, type Role } from '@/lib/authz/roles';
import type { Email } from '@/lib/email';

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
  /** When the invitation expires, already formatted. */
  expires: string;
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
 * @param props.expires - When it expires.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function InvitationReminderEmail({
  appUrl,
  inviterName,
  companyName,
  role,
  url,
  expires,
  logoSrc = undefined,
}: InvitationReminderEmailProps) {
  return (
    <EmailLayout
      preview={`Your invitation to ${companyName} expires soon`}
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason={`You're receiving this because ${inviterName} invited this email address to ${companyName} and the invitation hasn't been accepted yet. If you weren't expecting it, you can ignore this email.`}
    >
      <EmailHeading>Your invitation expires soon</EmailHeading>
      <EmailParagraph>
        {inviterName} invited you to join {companyName} on Adiutor as {ROLE_LABELS[role]}. The
        invitation is still open until {expires}.
      </EmailParagraph>
      <EmailButton href={url}>Accept invitation</EmailButton>
      <EmailNote>
        This link replaces the one in the earlier email, which no longer works. It works once.
      </EmailNote>
      <LinkFallback url={url} />
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
  expires: '25 Oct 2026, 14:05 UTC',
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
    `Reminder: join ${props.companyName} on Adiutor`,
    <InvitationReminderEmail {...props} />,
  );
}
