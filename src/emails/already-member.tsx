/**
 * @file Email sent instead of an invitation when the person is already a
 * member, so the inviter's screen can say "sent" without revealing anything.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph } from '@/components/email/email-text';
import type { Email } from '@/lib/email';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link AlreadyMemberEmail}.
 */
export interface AlreadyMemberEmailProps extends EmailBaseProps {
  /** Name of the company. */
  companyName: string;
  /** Link to the company in Adiutor. */
  url: string;
}

/**
 * Tells the recipient nothing needs doing, with a button to open the company.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.companyName - The company.
 * @param props.url - Link to the company.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function AlreadyMemberEmail({
  appUrl,
  companyName,
  url,
  logoSrc = undefined,
}: AlreadyMemberEmailProps) {
  return (
    <EmailLayout
      preview="No action needed"
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason={`You're receiving this because someone tried to invite this email address to ${companyName}.`}
    >
      <EmailHeading>You&apos;re already a member</EmailHeading>
      <EmailParagraph>
        Someone tried to invite you to {companyName} on Adiutor, but you&apos;re already a member.
        No action is needed.
      </EmailParagraph>
      <EmailButton href={url}>Open {companyName}</EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
AlreadyMemberEmail.PreviewProps = {
  ...PREVIEW_BASE,
  companyName: 'Adiutor',
  url: 'https://adiutor.dev/companies/example',
} satisfies AlreadyMemberEmailProps;

/**
 * Builds the "already a member" email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function alreadyMemberEmail(to: string, props: AlreadyMemberEmailProps): Promise<Email> {
  return renderEmail(
    to,
    `You're already a member of ${props.companyName} on Adiutor`,
    <AlreadyMemberEmail {...props} />,
  );
}
