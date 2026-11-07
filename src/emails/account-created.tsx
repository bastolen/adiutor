/**
 * @file Welcome email for an account a staff member registered, with a link
 * to choose a password.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import {
  EmailHeading,
  EmailNote,
  EmailParagraph,
  LinkFallback,
} from '@/components/email/email-text';
import type { Email } from '@/lib/email';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link AccountCreatedEmail}.
 */
export interface AccountCreatedEmailProps extends EmailBaseProps {
  /** Name (or email) of the staff member who created the account. */
  creatorName: string;
  /** The name the staff are shown with to users, e.g. "Adiutor". */
  staffName: string;
  /** Link to choose a password. */
  url: string;
  /** How many days the link stays valid. */
  validDays: number;
}

/**
 * Says who created the account and lets the recipient choose a password.
 * Signing in with an email link always works too.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.creatorName - Who created it.
 * @param props.staffName - The staff's name shown to users.
 * @param props.url - Link to choose a password.
 * @param props.validDays - Days the link stays valid.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function AccountCreatedEmail({
  appUrl,
  creatorName,
  staffName,
  url,
  validDays,
  logoSrc = undefined,
}: AccountCreatedEmailProps) {
  return (
    <EmailLayout
      preview="Your Adiutor account is ready"
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason={`You're receiving this because ${creatorName} of ${staffName} created an Adiutor account for this email address. If you weren't expecting it, you can ignore this email.`}
    >
      <EmailHeading>Your Adiutor account is ready</EmailHeading>
      <EmailParagraph>
        {creatorName} of {staffName} created an Adiutor account for you. Choose a password to sign
        in.
      </EmailParagraph>
      <EmailButton href={url}>Choose your password</EmailButton>
      <EmailNote>
        The link works once and expires in {validDays} days. You can also sign in with a link sent
        to this address at {appUrl}/auth.
      </EmailNote>
      <LinkFallback url={url} />
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
AccountCreatedEmail.PreviewProps = {
  ...PREVIEW_BASE,
  creatorName: 'Alex Doe',
  staffName: 'Adiutor',
  url: 'https://adiutor.dev/auth/reset-password?token=example&welcome=1',
  validDays: 7,
} satisfies AccountCreatedEmailProps;

/**
 * Builds the welcome email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function accountCreatedEmail(to: string, props: AccountCreatedEmailProps): Promise<Email> {
  return renderEmail(to, 'Your Adiutor account is ready', <AccountCreatedEmail {...props} />);
}
