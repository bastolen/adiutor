/**
 * @file Email telling each staff Admin, the one who made the change too,
 * that the mail server Adiutor sends email through changed: whoever controls
 * it can read every sign-in link and code Adiutor sends, so a change nobody
 * recognises gets noticed.
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
 * Props for {@link SmtpChangedEmail}.
 */
export interface SmtpChangedEmailProps extends EmailBaseProps {
  /** The new mail server, as `host:port`. */
  server: string;
  /** The staff Admin who changed it (name or email), if their account still exists. */
  byName: string | null;
  /** Link to the mail server card of Settings. */
  url: string;
}

/**
 * Names who changed the mail server and the new one, says why it matters and
 * what to do if the recipient doesn't recognise it, and links to the mail
 * server card. Without the device or IP address of whoever made the change.
 */
export default function SmtpChangedEmail({
  appUrl,
  server,
  byName,
  url,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: SmtpChangedEmailProps) {
  const t = translator(locale, 'emails.smtpChanged');
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
      <EmailParagraph colours={colours}>
        {byName ? t('changedBy', { by: byName, server, staff }) : t('changed', { server, staff })}
      </EmailParagraph>
      <EmailParagraph colours={colours}>{t('advice', { staff })}</EmailParagraph>
      <EmailButton colours={colours} href={url}>
        {t('button')}
      </EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
SmtpChangedEmail.PreviewProps = {
  ...PREVIEW_BASE,
  server: 'smtp.adiutor.dev:587',
  byName: 'Alex Doe',
  url: 'https://adiutor.dev/admin/settings/integrations#mail-server',
} satisfies SmtpChangedEmailProps;

/**
 * Builds the "the mail server changed" email.
 *
 * @param to - Recipient address: a staff Admin.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function smtpChangedEmail(to: string, props: SmtpChangedEmailProps): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.smtpChanged')('subject', {
      staff: emailName(props.brand),
    }),
    <SmtpChangedEmail {...props} />,
  );
}
