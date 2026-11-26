/**
 * @file Email confirming the address of someone who opened an invite link.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import {
  EmailHeading,
  EmailNote,
  EmailParagraph,
  LinkFallback,
} from '@/components/email/email-text';
import RoleSummary from '@/components/email/role-summary';
import { emailColours, emailName } from '@/components/email/theme';
import type { Role } from '@/lib/authz/roles';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

import { type EmailBaseProps, type InviteTarget, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link InviteLinkConfirmationEmail}.
 */
export interface InviteLinkConfirmationEmailProps extends EmailBaseProps {
  /** Name of the company, or the staff's for a link to the staff. */
  companyName: string;
  /**
   * Whether it's to a company or to the staff, whose name `companyName` then
   * holds: the email names it once (`InviteTarget`).
   */
  target: InviteTarget;
  /** The role they'll get. */
  role: Role;
  /** Link to join. */
  url: string;
  /** How many days the link stays valid. */
  validDays: number;
}

/**
 * Sent after someone opens a single-use invite link and enters their email
 * address: joining proves they own it.
 */
export default function InviteLinkConfirmationEmail({
  appUrl,
  companyName,
  target,
  role,
  url,
  validDays,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: InviteLinkConfirmationEmailProps) {
  const colours = emailColours(brand);
  const t = translator(locale, 'emails.inviteLinkConfirmation');
  const values = {
    company: companyName,
    target,
    staff: emailName(brand),
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
      <EmailHeading colours={colours}>{t('heading')}</EmailHeading>
      <EmailParagraph colours={colours}>{t('body', values)}</EmailParagraph>
      <RoleSummary colours={colours} role={role} locale={locale} />
      <EmailButton colours={colours} href={url}>
        {t('button', values)}
      </EmailButton>
      <EmailNote colours={colours}>{t('note', { days: validDays })}</EmailNote>
      <LinkFallback colours={colours} url={url} locale={locale} />
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
InviteLinkConfirmationEmail.PreviewProps = {
  ...PREVIEW_BASE,
  companyName: 'Adiutor',
  target: 'company',
  role: 'watcher',
  url: 'https://adiutor.dev/invite/example',
  validDays: 7,
} satisfies InviteLinkConfirmationEmailProps;

/**
 * Builds the invite-link confirmation email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function inviteLinkConfirmationEmail(
  to: string,
  props: InviteLinkConfirmationEmailProps,
): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.inviteLinkConfirmation')('subject', {
      company: props.companyName,
    }),
    <InviteLinkConfirmationEmail {...props} />,
  );
}
