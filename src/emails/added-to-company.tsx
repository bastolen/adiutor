/**
 * @file Email telling someone a staff member added them to a company.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph } from '@/components/email/email-text';
import RoleSummary from '@/components/email/role-summary';
import { ROLE_LABELS, type Role } from '@/lib/authz/roles';
import type { Email } from '@/lib/email';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link AddedToCompanyEmail}.
 */
export interface AddedToCompanyEmailProps extends EmailBaseProps {
  /** Name (or email) of the staff member who added them. */
  adderName: string;
  /** Name of the company. */
  companyName: string;
  /** Their role there. */
  role: Role;
  /** Link to the company in Adiutor. */
  url: string;
}

/**
 * Says who added the recipient to which company and in which role (with
 * what that role can do), with a button to open it.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.adderName - Who added them.
 * @param props.companyName - The company.
 * @param props.role - Their role.
 * @param props.url - Link to the company.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function AddedToCompanyEmail({
  appUrl,
  adderName,
  companyName,
  role,
  url,
  logoSrc = undefined,
}: AddedToCompanyEmailProps) {
  return (
    <EmailLayout
      preview={`You now have access to ${companyName} on Adiutor`}
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason={`You're receiving this because ${adderName} added your account to ${companyName}.`}
    >
      <EmailHeading>You were added to {companyName}</EmailHeading>
      <EmailParagraph>
        {adderName} added you to {companyName} on Adiutor as {ROLE_LABELS[role]}.
      </EmailParagraph>
      <RoleSummary role={role} />
      <EmailButton href={url}>Open {companyName}</EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
AddedToCompanyEmail.PreviewProps = {
  ...PREVIEW_BASE,
  adderName: 'Alex Doe',
  companyName: 'Adiutor',
  role: 'client',
  url: 'https://adiutor.dev/companies/example',
} satisfies AddedToCompanyEmailProps;

/**
 * Builds the "added to a company" email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function addedToCompanyEmail(to: string, props: AddedToCompanyEmailProps): Promise<Email> {
  return renderEmail(
    to,
    `You were added to ${props.companyName} on Adiutor`,
    <AddedToCompanyEmail {...props} />,
  );
}
