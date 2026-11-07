/**
 * @file Email telling the staff Admins that someone else became a staff
 * Admin, so an account a stolen session left behind gets noticed.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph } from '@/components/email/email-text';
import type { Email } from '@/lib/email';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link StaffAdminAddedEmail}.
 */
export interface StaffAdminAddedEmailProps extends EmailBaseProps {
  /** The new staff Admin's name (or email when they have no name). */
  newAdminName: string;
  /** The new staff Admin's email address. */
  newAdminEmail: string;
  /**
   * How they became one: a staff Admin gave them the role (`role`), or they
   * accepted an invitation or used an invite link (`invitation`).
   */
  how: 'role' | 'invitation';
  /** Who gave the role or sent the invitation (name or email), if their account still exists. */
  byName: string | null;
  /** Link to the staff page. */
  url: string;
}

/**
 * Names the new staff Admin and how they became one, says what to do if the
 * recipient doesn't recognise it, and links to the staff page. Without the
 * device or IP address of whoever made the change.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.newAdminName - The new Admin's name.
 * @param props.newAdminEmail - The new Admin's email address.
 * @param props.how - How they became one.
 * @param props.byName - Who gave the role or sent the invitation, if known.
 * @param props.url - Link to the staff page.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function StaffAdminAddedEmail({
  appUrl,
  newAdminName,
  newAdminEmail,
  how,
  byName,
  url,
  logoSrc = undefined,
}: StaffAdminAddedEmailProps) {
  // Their address once, also when it's all there is to name them by.
  const who = newAdminName === newAdminEmail ? newAdminEmail : `${newAdminName} (${newAdminEmail})`;
  let what = `${who} accepted an invitation to the staff and is now a staff Admin on Adiutor.`;
  if (how === 'role') {
    what = byName
      ? `${byName} made ${who} a staff Admin on Adiutor.`
      : `${who} was made a staff Admin on Adiutor.`;
  } else if (byName) {
    what = `${who} accepted ${byName}’s invitation and is now a staff Admin on Adiutor.`;
  }
  return (
    <EmailLayout
      preview={`${newAdminName} is now a staff Admin on Adiutor`}
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason="You're receiving this because you're a staff Admin on Adiutor: staff Admins are told whenever someone becomes one."
    >
      <EmailHeading>{newAdminName} is now a staff Admin</EmailHeading>
      <EmailParagraph>{what}</EmailParagraph>
      <EmailParagraph>
        Staff Admins can manage everything on Adiutor, the staff included. If you don&apos;t
        recognise this, remove their staff access on the staff page and check the audit log.
      </EmailParagraph>
      <EmailButton href={url}>Open the staff page</EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
StaffAdminAddedEmail.PreviewProps = {
  ...PREVIEW_BASE,
  newAdminName: 'Sam Doe',
  newAdminEmail: 'sam@adiutor.dev',
  how: 'role',
  byName: 'Alex Doe',
  url: 'https://adiutor.dev/admin/staff',
} satisfies StaffAdminAddedEmailProps;

/**
 * Builds the "new staff Admin" email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function staffAdminAddedEmail(to: string, props: StaffAdminAddedEmailProps): Promise<Email> {
  return renderEmail(
    to,
    `${props.newAdminName} is now a staff Admin on Adiutor`,
    <StaffAdminAddedEmail {...props} />,
  );
}
