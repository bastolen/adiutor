/**
 * @file Email with a one-time code for the second sign-in step, or for
 * turning on email codes.
 */
import EmailCode from '@/components/email/email-code';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailNote, EmailParagraph } from '@/components/email/email-text';
import { EMAIL_CODE_MINUTES } from '@/lib/authz/mfa';
import type { Email } from '@/lib/email';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link TwoFactorCodeEmail}.
 */
export interface TwoFactorCodeEmailProps extends EmailBaseProps {
  /** The one-time code. */
  code: string;
}

/**
 * Shows the code in a large box (`EmailCode`). It expires in
 * `EMAIL_CODE_MINUTES` minutes.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.code - The code.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function TwoFactorCodeEmail({
  appUrl,
  code,
  logoSrc = undefined,
}: TwoFactorCodeEmailProps) {
  return (
    <EmailLayout
      preview={`Your Adiutor code is ${code}`}
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason="You're receiving this because someone signed in to Adiutor with your password, or turned on email codes for your account. If that wasn't you, change your password right away."
    >
      <EmailHeading>Your sign-in code</EmailHeading>
      <EmailParagraph>Enter this code in Adiutor to continue:</EmailParagraph>
      <EmailCode code={code} />
      <EmailNote>
        The code expires in {EMAIL_CODE_MINUTES} minutes. Never share it with anyone.
      </EmailNote>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
TwoFactorCodeEmail.PreviewProps = {
  ...PREVIEW_BASE,
  code: '482915',
} satisfies TwoFactorCodeEmailProps;

/**
 * Builds the code email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function twoFactorCodeEmail(to: string, props: TwoFactorCodeEmailProps): Promise<Email> {
  return renderEmail(to, 'Your Adiutor sign-in code', <TwoFactorCodeEmail {...props} />);
}
