/**
 * @file Email sent instead of an invitation when the person is already a
 * member, so the inviter's screen can say "sent" without revealing anything.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph } from '@/components/email/email-text';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link AlreadyMemberEmail}.
 */
export interface AlreadyMemberEmailProps extends EmailBaseProps {
  /** Name of the company. */
  companyName: string;
  /** Link to the company in Adiutor. */
  url: string;
}

/**
 * Tells the recipient nothing needs doing, with a button to open the company.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.companyName - The company.
 * @param props.url - Link to the company.
 * @param props.locale - The recipient's language.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function AlreadyMemberEmail({
  appUrl,
  companyName,
  url,
  locale,
  logoSrc = undefined,
}: AlreadyMemberEmailProps) {
  const t = translator(locale, 'emails.alreadyMember');
  const values = { company: companyName };
  return (
    <EmailLayout
      preview={t('preview')}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      reason={t('reason', values)}
    >
      <EmailHeading>{t('heading')}</EmailHeading>
      <EmailParagraph>{t('body', values)}</EmailParagraph>
      <EmailButton href={url}>{t('button', values)}</EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
AlreadyMemberEmail.PreviewProps = {
  ...PREVIEW_BASE,
  companyName: 'Adiutor',
  url: 'https://adiutor.dev/companies/example',
} satisfies AlreadyMemberEmailProps;

/**
 * Builds the "already a member" email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function alreadyMemberEmail(to: string, props: AlreadyMemberEmailProps): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.alreadyMember')('subject', { company: props.companyName }),
    <AlreadyMemberEmail {...props} />,
  );
}
