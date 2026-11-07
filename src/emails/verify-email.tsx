/**
 * @file Email with a link to verify the account's email address.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph, LinkFallback } from '@/components/email/email-text';
import type { Email } from '@/lib/email';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link VerifyEmailEmail}.
 */
export interface VerifyEmailEmailProps extends EmailBaseProps {
  /** The verification link. */
  url: string;
}

/**
 * Asks the recipient to confirm the address is theirs. The link expires in 1
 * hour.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.url - The verification link.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function VerifyEmailEmail({
  appUrl,
  url,
  logoSrc = undefined,
}: VerifyEmailEmailProps) {
  return (
    <EmailLayout
      preview="Confirm this is your email address"
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason="You're receiving this because someone asked to verify this email address for an Adiutor account. If that wasn't you, you can ignore this email."
    >
      <EmailHeading>Verify your email address</EmailHeading>
      <EmailParagraph>
        Confirm that this email address belongs to you. Once it&apos;s verified, accounts with the
        same address at a provider you can sign in with (such as GitHub) can connect to your account
        automatically. The link expires in 1 hour.
      </EmailParagraph>
      <EmailButton href={url}>Verify email address</EmailButton>
      <LinkFallback url={url} />
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
VerifyEmailEmail.PreviewProps = {
  ...PREVIEW_BASE,
  url: 'https://adiutor.dev/api/auth/verify-email?token=example',
} satisfies VerifyEmailEmailProps;

/**
 * Builds the verification email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function verifyEmailEmail(to: string, props: VerifyEmailEmailProps): Promise<Email> {
  return renderEmail(to, 'Verify your Adiutor email address', <VerifyEmailEmail {...props} />);
}
