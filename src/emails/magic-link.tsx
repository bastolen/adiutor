/**
 * @file Email with a one-time link to sign in.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph, LinkFallback } from '@/components/email/email-text';
import { emailColours, emailName } from '@/components/email/theme';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';
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
 */
export default function MagicLinkEmail({
  appUrl,
  url,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: MagicLinkEmailProps) {
  const colours = emailColours(brand);
  const staff = emailName(brand);
  const t = translator(locale, 'emails.magicLink');
  return (
    <EmailLayout
      preview={t('preview', { staff })}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      brand={brand}
      reason={t('reason', { staff })}
    >
      <EmailHeading colours={colours}>{t('heading', { staff })}</EmailHeading>
      <EmailParagraph colours={colours}>
        {t('body', { minutes: EMAIL_LINK_MINUTES })}
      </EmailParagraph>
      <EmailButton colours={colours} href={url}>
        {t('button')}
      </EmailButton>
      <LinkFallback colours={colours} url={url} locale={locale} />
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
  return renderEmail(
    to,
    translator(props.locale, 'emails.magicLink')('subject', { staff: emailName(props.brand) }),
    <MagicLinkEmail {...props} />,
  );
}
