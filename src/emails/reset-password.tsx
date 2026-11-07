/**
 * @file Email with a link to choose a new password.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph, LinkFallback } from '@/components/email/email-text';
import type { Email } from '@/lib/email';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link ResetPasswordEmail}.
 */
export interface ResetPasswordEmailProps extends EmailBaseProps {
  /** The link to choose a new password. */
  url: string;
}

/**
 * Lets the recipient choose a new password. The link expires in 1 hour.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.url - The reset link.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function ResetPasswordEmail({
  appUrl,
  url,
  logoSrc = undefined,
}: ResetPasswordEmailProps) {
  return (
    <EmailLayout
      preview="Choose a new password for Adiutor"
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason="You're receiving this because someone asked to reset the password for this email address. If that wasn't you, you can ignore this email: your password stays the same."
    >
      <EmailHeading>Reset your password</EmailHeading>
      <EmailParagraph>
        We received a request to reset the password of your Adiutor account. Choose a new one with
        the button below. The link expires in 1 hour.
      </EmailParagraph>
      <EmailButton href={url}>Choose a new password</EmailButton>
      <LinkFallback url={url} />
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
ResetPasswordEmail.PreviewProps = {
  ...PREVIEW_BASE,
  url: 'https://adiutor.dev/auth/reset-password?token=example',
} satisfies ResetPasswordEmailProps;

/**
 * Builds the password reset email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function resetPasswordEmail(to: string, props: ResetPasswordEmailProps): Promise<Email> {
  return renderEmail(to, 'Reset your Adiutor password', <ResetPasswordEmail {...props} />);
}
