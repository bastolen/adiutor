/**
 * @file Email telling the staff Admins that someone else became a staff
 * Admin, so an account a stolen session left behind gets noticed.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph } from '@/components/email/email-text';
import { emailColours } from '@/components/email/theme';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link StaffAdminAddedEmail}.
 */
export interface StaffAdminAddedEmailProps extends EmailBaseProps {
  /** The new staff Admin's name (or email when they have no name). */
  newAdminName: string;
  /** The new staff Admin's email address. */
  newAdminEmail: string;
  /**
   * How they became one: a staff Admin gave them the role (`role`), they
   * accepted an invitation or used an invite link (`invitation`), or a staff
   * Admin reactivated their account, which had kept the role (`reactivation`).
   */
  how: 'role' | 'invitation' | 'reactivation';
  /**
   * Who gave the role, sent the invitation or reactivated the account (name
   * or email), if their account still exists.
   */
  byName: string | null;
  /** Link to the staff settings. */
  url: string;
}

/**
 * Names the new staff Admin and how they became one, says what to do if the
 * recipient doesn't recognise it, and links to the staff settings. Without the
 * device or IP address of whoever made the change.
 */
export default function StaffAdminAddedEmail({
  appUrl,
  newAdminName,
  newAdminEmail,
  how,
  byName,
  url,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: StaffAdminAddedEmailProps) {
  const colours = emailColours(brand);
  const t = translator(locale, 'emails.staffAdminAdded');
  // Their address once, also when it's all there is to name them by.
  const who =
    newAdminName === newAdminEmail
      ? newAdminEmail
      : t('nameWithEmail', { name: newAdminName, email: newAdminEmail });
  let what = t('accepted', { who });
  if (how === 'role') {
    what = byName ? t('madeBy', { by: byName, who }) : t('made', { who });
  } else if (how === 'reactivation') {
    what = byName ? t('reactivatedBy', { by: byName, who }) : t('reactivated', { who });
  } else if (byName) {
    what = t('acceptedFrom', { by: byName, who });
  }
  return (
    <EmailLayout
      preview={t('subject', { name: newAdminName })}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      brand={brand}
      reason={t('reason')}
    >
      <EmailHeading colours={colours}>{t('heading', { name: newAdminName })}</EmailHeading>
      <EmailParagraph colours={colours}>{what}</EmailParagraph>
      <EmailParagraph colours={colours}>{t('advice')}</EmailParagraph>
      <EmailButton colours={colours} href={url}>
        {t('button')}
      </EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
StaffAdminAddedEmail.PreviewProps = {
  ...PREVIEW_BASE,
  newAdminName: 'Sam Doe',
  newAdminEmail: 'sam@adiutor.dev',
  how: 'role',
  byName: 'Alex Doe',
  url: 'https://adiutor.dev/admin/settings/staff',
} satisfies StaffAdminAddedEmailProps;

/**
 * Builds the "new staff Admin" email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function staffAdminAddedEmail(to: string, props: StaffAdminAddedEmailProps): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.staffAdminAdded')('subject', { name: props.newAdminName }),
    <StaffAdminAddedEmail {...props} />,
  );
}
