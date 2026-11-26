/**
 * @file Email telling someone a staff member added them to a company.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph } from '@/components/email/email-text';
import RoleSummary from '@/components/email/role-summary';
import { emailColours } from '@/components/email/theme';
import type { Role } from '@/lib/authz/roles';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link AddedToCompanyEmail}.
 */
export interface AddedToCompanyEmailProps extends EmailBaseProps {
  /** Name (or email) of the staff member who added them. */
  adderName: string;
  /** Name of the company. */
  companyName: string;
  /** Their role there. */
  role: Role;
  /** Link to the company in Adiutor. */
  url: string;
}

/**
 * Says who added the recipient to which company and in which role (with
 * what that role can do), with a button to open it.
 */
export default function AddedToCompanyEmail({
  appUrl,
  adderName,
  companyName,
  role,
  url,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: AddedToCompanyEmailProps) {
  const colours = emailColours(brand);
  const t = translator(locale, 'emails.addedToCompany');
  const values = {
    adder: adderName,
    company: companyName,
    role: translator(locale, 'roles')(`${role}.label`),
  };
  return (
    <EmailLayout
      preview={t('preview', values)}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      brand={brand}
      reason={t('reason', values)}
    >
      <EmailHeading colours={colours}>{t('heading', values)}</EmailHeading>
      <EmailParagraph colours={colours}>{t('body', values)}</EmailParagraph>
      <RoleSummary colours={colours} role={role} locale={locale} />
      <EmailButton colours={colours} href={url}>
        {t('button', values)}
      </EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
AddedToCompanyEmail.PreviewProps = {
  ...PREVIEW_BASE,
  adderName: 'Alex Doe',
  companyName: 'Adiutor',
  role: 'client',
  url: 'https://adiutor.dev/companies/example',
} satisfies AddedToCompanyEmailProps;

/**
 * Builds the "added to a company" email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function addedToCompanyEmail(to: string, props: AddedToCompanyEmailProps): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.addedToCompany')('subject', { company: props.companyName }),
    <AddedToCompanyEmail {...props} />,
  );
}
