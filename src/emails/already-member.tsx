/**
 * @file Email sent instead of an invitation when the person is already a
 * member, so the inviter's screen can say "sent" without revealing anything.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph } from '@/components/email/email-text';
import { emailColours, emailName } from '@/components/email/theme';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

import { type EmailBaseProps, type InviteTarget, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link AlreadyMemberEmail}.
 */
export interface AlreadyMemberEmailProps extends EmailBaseProps {
  /** Name of the company, or the staff's for an invitation to the staff. */
  companyName: string;
  /**
   * Whether it's to a company or to the staff, whose name `companyName` then
   * holds: the email names it once (`InviteTarget`).
   */
  target: InviteTarget;
  /** Link to the company, or to the dashboard for the staff. */
  url: string;
}

/**
 * Tells the recipient nothing needs doing, with a button to open the company.
 */
export default function AlreadyMemberEmail({
  appUrl,
  companyName,
  target,
  url,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: AlreadyMemberEmailProps) {
  const colours = emailColours(brand);
  const t = translator(locale, 'emails.alreadyMember');
  const values = { company: companyName, target, staff: emailName(brand) };
  return (
    <EmailLayout
      preview={t('preview')}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      brand={brand}
      reason={t('reason', values)}
    >
      <EmailHeading colours={colours}>{t('heading')}</EmailHeading>
      <EmailParagraph colours={colours}>{t('body', values)}</EmailParagraph>
      <EmailButton colours={colours} href={url}>
        {t('button', values)}
      </EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
AlreadyMemberEmail.PreviewProps = {
  ...PREVIEW_BASE,
  companyName: 'Adiutor',
  target: 'company',
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
    translator(props.locale, 'emails.alreadyMember')('subject', {
      company: props.companyName,
      target: props.target,
      staff: emailName(props.brand),
    }),
    <AlreadyMemberEmail {...props} />,
  );
}
