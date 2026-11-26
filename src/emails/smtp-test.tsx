/**
 * @file Email that tries a mail server before the Email tab of Settings
 * saves it: sent through that server to the staff Admin who's saving it, so
 * it only counts once the server took it.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph } from '@/components/email/email-text';
import { emailColours, emailName } from '@/components/email/theme';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link SmtpTestEmail}.
 */
export interface SmtpTestEmailProps extends EmailBaseProps {
  /** The mail server being tried, as `host:port`. */
  server: string;
  /** Link to the Email tab of Settings. */
  url: string;
}

/**
 * Says the email came through the mail server being tried, so it can be
 * saved, and links back to the Email tab.
 */
export default function SmtpTestEmail({
  appUrl,
  server,
  url,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: SmtpTestEmailProps) {
  const t = translator(locale, 'emails.smtpTest');
  const colours = emailColours(brand);
  const staff = emailName(brand);
  return (
    <EmailLayout
      preview={t('subject', { staff })}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      brand={brand}
      reason={t('reason', { staff })}
    >
      <EmailHeading colours={colours}>{t('heading')}</EmailHeading>
      <EmailParagraph colours={colours}>{t('body', { server, staff })}</EmailParagraph>
      <EmailButton colours={colours} href={url}>
        {t('button')}
      </EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
SmtpTestEmail.PreviewProps = {
  ...PREVIEW_BASE,
  server: 'smtp.adiutor.dev:587',
  url: 'https://adiutor.dev/admin/settings/connections#mail-server',
} satisfies SmtpTestEmailProps;

/**
 * Builds the mail server's test email.
 *
 * @param to - Recipient address: the staff Admin who's saving the mail server.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function smtpTestEmail(to: string, props: SmtpTestEmailProps): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.smtpTest')('subject', { staff: emailName(props.brand) }),
    <SmtpTestEmail {...props} />,
  );
}
