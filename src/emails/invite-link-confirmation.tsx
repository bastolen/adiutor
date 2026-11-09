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
import type { Role } from '@/lib/authz/roles';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link InviteLinkConfirmationEmail}.
 */
export interface InviteLinkConfirmationEmailProps extends EmailBaseProps {
  /** Name of the company. */
  companyName: string;
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
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.companyName - The company.
 * @param props.role - The role.
 * @param props.url - Join link.
 * @param props.validDays - Days the link stays valid.
 * @param props.locale - The recipient's language.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
 */
export default function InviteLinkConfirmationEmail({
  appUrl,
  companyName,
  role,
  url,
  validDays,
  locale,
  logoSrc = undefined,
}: InviteLinkConfirmationEmailProps) {
  const t = translator(locale, 'emails.inviteLinkConfirmation');
  const values = { company: companyName, role: translator(locale, 'roles')(`${role}.label`) };
  return (
    <EmailLayout
      preview={t('preview', values)}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      reason={t('reason', values)}
    >
      <EmailHeading>{t('heading')}</EmailHeading>
      <EmailParagraph>{t('body', values)}</EmailParagraph>
      <RoleSummary role={role} locale={locale} />
      <EmailButton href={url}>{t('button', values)}</EmailButton>
      <EmailNote>{t('note', { days: validDays })}</EmailNote>
      <LinkFallback url={url} locale={locale} />
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
InviteLinkConfirmationEmail.PreviewProps = {
  ...PREVIEW_BASE,
  companyName: 'Adiutor',
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
