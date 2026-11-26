/**
 * @file Welcome email for an account a staff member registered, with a link
 * to choose a password.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import {
  EmailHeading,
  EmailNote,
  EmailParagraph,
  LinkFallback,
} from '@/components/email/email-text';
import { emailColours } from '@/components/email/theme';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link AccountCreatedEmail}.
 */
export interface AccountCreatedEmailProps extends EmailBaseProps {
  /** Name (or email) of the staff member who created the account. */
  creatorName: string;
  /** The name the staff are shown with to users, e.g. "Adiutor". */
  staffName: string;
  /** Link to choose a password. */
  url: string;
  /** How many days the link stays valid. */
  validDays: number;
}

/**
 * Says who created the account and lets the recipient choose a password.
 * Signing in with an email link always works too.
 */
export default function AccountCreatedEmail({
  appUrl,
  creatorName,
  staffName,
  url,
  validDays,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: AccountCreatedEmailProps) {
  const colours = emailColours(brand);
  const t = translator(locale, 'emails.accountCreated');
  const values = { creator: creatorName, staff: staffName };
  return (
    <EmailLayout
      preview={t('subject')}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      brand={brand}
      reason={t('reason', values)}
    >
      <EmailHeading colours={colours}>{t('heading')}</EmailHeading>
      <EmailParagraph colours={colours}>{t('body', values)}</EmailParagraph>
      <EmailButton colours={colours} href={url}>
        {t('button')}
      </EmailButton>
      <EmailNote colours={colours}>
        {t('note', { days: validDays, signInUrl: `${appUrl}/auth` })}
      </EmailNote>
      <LinkFallback colours={colours} url={url} locale={locale} />
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
AccountCreatedEmail.PreviewProps = {
  ...PREVIEW_BASE,
  creatorName: 'Alex Doe',
  staffName: 'Adiutor',
  url: 'https://adiutor.dev/auth/reset-password?token=example&welcome=1',
  validDays: 7,
} satisfies AccountCreatedEmailProps;

/**
 * Builds the welcome email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function accountCreatedEmail(to: string, props: AccountCreatedEmailProps): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.accountCreated')('subject'),
    <AccountCreatedEmail {...props} />,
  );
}
