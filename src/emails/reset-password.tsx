/**
 * @file Email with a link to choose a new password.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph, LinkFallback } from '@/components/email/email-text';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

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
 * @param props.locale - The recipient's language.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function ResetPasswordEmail({
  appUrl,
  url,
  locale,
  logoSrc = undefined,
}: ResetPasswordEmailProps) {
  const t = translator(locale, 'emails.resetPassword');
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
  return renderEmail(
    to,
    translator(props.locale, 'emails.resetPassword')('subject'),
    <ResetPasswordEmail {...props} />,
  );
}
