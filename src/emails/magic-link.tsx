/**
 * @file Email with a one-time link to sign in.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph, LinkFallback } from '@/components/email/email-text';
import type { Email } from '@/lib/email';
import { EMAIL_LINK_MINUTES } from '@/lib/sign-in/email-link';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link MagicLinkEmail}.
 */
export interface MagicLinkEmailProps extends EmailBaseProps {
  /** The sign-in link. */
  url: string;
}

/**
 * Asks the recipient to sign in with the button. The link works once and
 * expires in 5 minutes.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.url - The sign-in link.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function MagicLinkEmail({ appUrl, url, logoSrc = undefined }: MagicLinkEmailProps) {
  return (
    <EmailLayout
      preview="Your link to sign in to Adiutor"
      appUrl={appUrl}
      logoSrc={logoSrc}
      reason="You're receiving this because someone asked to sign in to Adiutor with this email address. If that wasn't you, you can ignore this email: nobody can sign in without this link."
    >
      <EmailHeading>Sign in to Adiutor</EmailHeading>
      <EmailParagraph>
        Use the button below to sign in. The link works once and expires in {EMAIL_LINK_MINUTES}{' '}
        minutes.
      </EmailParagraph>
      <EmailButton href={url}>Sign in</EmailButton>
      <LinkFallback url={url} />
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
MagicLinkEmail.PreviewProps = {
  ...PREVIEW_BASE,
  url: 'https://adiutor.dev/auth/email-link?token=example',
} satisfies MagicLinkEmailProps;

/**
 * Builds the sign-in email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function magicLinkEmail(to: string, props: MagicLinkEmailProps): Promise<Email> {
  return renderEmail(to, 'Your Adiutor sign-in link', <MagicLinkEmail {...props} />);
}
