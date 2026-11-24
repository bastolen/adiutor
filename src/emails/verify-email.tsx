/**
 * @file Email with a link to verify the account's email address.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph, LinkFallback } from '@/components/email/email-text';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

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
 * @returns The email.
 */
export default function VerifyEmailEmail({
  appUrl,
  url,
  locale,
  logoSrc = undefined,
}: VerifyEmailEmailProps) {
  const t = translator(locale, 'emails.verifyEmail');
  return (
    <EmailLayout
      preview={t('preview')}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      reason={t('reason')}
    >
      <EmailHeading>{t('heading')}</EmailHeading>
      <EmailParagraph>{t('body')}</EmailParagraph>
      <EmailButton href={url}>{t('button')}</EmailButton>
      <LinkFallback url={url} locale={locale} />
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
  return renderEmail(
    to,
    translator(props.locale, 'emails.verifyEmail')('subject'),
    <VerifyEmailEmail {...props} />,
  );
}
