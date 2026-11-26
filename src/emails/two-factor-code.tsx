/**
 * @file Email with a one-time code for the second sign-in step, or for
 * turning on email codes.
 */
import EmailCode from '@/components/email/email-code';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailNote, EmailParagraph } from '@/components/email/email-text';
import { emailColours } from '@/components/email/theme';
import { EMAIL_CODE_MINUTES } from '@/lib/authz/mfa';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

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
 */
export default function TwoFactorCodeEmail({
  appUrl,
  code,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: TwoFactorCodeEmailProps) {
  const colours = emailColours(brand);
  const t = translator(locale, 'emails.twoFactorCode');
  return (
    <EmailLayout
      preview={t('preview', { code })}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      brand={brand}
      reason={t('reason')}
    >
      <EmailHeading colours={colours}>{t('heading')}</EmailHeading>
      <EmailParagraph colours={colours}>{t('intro')}</EmailParagraph>
      <EmailCode colours={colours} code={code} />
      <EmailNote colours={colours}>{t('note', { minutes: EMAIL_CODE_MINUTES })}</EmailNote>
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
  return renderEmail(
    to,
    translator(props.locale, 'emails.twoFactorCode')('subject'),
    <TwoFactorCodeEmail {...props} />,
  );
}
