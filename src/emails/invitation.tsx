/**
 * @file Email inviting someone to join a company, sent by a person.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import {
  EmailHeading,
  EmailNote,
  EmailParagraph,
  LinkFallback,
} from '@/components/email/email-text';
import RoleSummary from '@/components/email/role-summary';
import { ROLE_LABELS, type Role } from '@/lib/authz/roles';
import type { Email } from '@/lib/email';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link InvitationEmail}.
 */
export interface InvitationEmailProps extends EmailBaseProps {
  /** Name (or email) of the person who sent the invitation. */
  inviterName: string;
  /** Name of the company. */
  companyName: string;
  /** The role they'll get. */
  role: Role;
  /** Link to accept the invitation. */
  url: string;
  /** How many days the link stays valid. */
  validDays: number;
}

/**
 * Says who invited the recipient, to which company and in which role (with
 * what that role can do), with a button to accept.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.inviterName - Who sent it.
 * @param props.companyName - The company.
 * @param props.role - The role.
 * @param props.url - Accept link.
 * @param props.validDays - Days the link stays valid.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function InvitationEmail({
  appUrl,
  inviterName,
  companyName,
  role,
  url,
  validDays,
  logoSrc = undefined,
}: InvitationEmailProps) {
  return (
    <EmailLayout
      preview={`Join ${companyName} on Adiutor as ${ROLE_LABELS[role]}`}
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason={`You're receiving this because ${inviterName} invited this email address to ${companyName}. If you weren't expecting it, you can ignore this email.`}
    >
      <EmailHeading>Join {companyName}</EmailHeading>
      <EmailParagraph>
        {inviterName} invited you to join {companyName} on Adiutor as {ROLE_LABELS[role]}.
      </EmailParagraph>
      <RoleSummary role={role} />
      <EmailButton href={url}>Accept invitation</EmailButton>
      <EmailNote>
        The link works once and expires in {validDays} days. You can sign in with an existing
        account or create one.
      </EmailNote>
      <LinkFallback url={url} />
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
InvitationEmail.PreviewProps = {
  ...PREVIEW_BASE,
  inviterName: 'Alex Doe',
  companyName: 'Adiutor',
  role: 'client',
  url: 'https://adiutor.dev/invite/example',
  validDays: 7,
} satisfies InvitationEmailProps;

/**
 * Builds the invitation email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function invitationEmail(to: string, props: InvitationEmailProps): Promise<Email> {
  return renderEmail(
    to,
    `${props.inviterName} invited you to join ${props.companyName} on Adiutor`,
    <InvitationEmail {...props} />,
  );
}
