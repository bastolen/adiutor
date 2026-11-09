/**
 * @file Email with a one-time link to sign in.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph, LinkFallback } from '@/components/email/email-text';
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
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.url - The sign-in link.
 * @param props.locale - The recipient's language.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function MagicLinkEmail({
  appUrl,
  url,
  locale,
  logoSrc = undefined,
}: MagicLinkEmailProps) {
  const t = translator(locale, 'emails.magicLink');
  return (
    <EmailLayout
      preview={t('preview')}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      reason={t('reason')}
    >
      <EmailHeading>{t('heading')}</EmailHeading>
      <EmailParagraph>{t('body', { minutes: EMAIL_LINK_MINUTES })}</EmailParagraph>
      <EmailButton href={url}>{t('button')}</EmailButton>
      <LinkFallback url={url} locale={locale} />
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
    translator(props.locale, 'emails.magicLink')('subject'),
    <MagicLinkEmail {...props} />,
  );
}
