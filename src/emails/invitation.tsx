/**
 * @file Email inviting someone to join a company, sent by a person.
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
 * Props for {@link InvitationEmail}.
 */
export interface InvitationEmailProps extends EmailBaseProps {
  /** Name (or email) of the person who sent the invitation. */
  inviterName: string;
  /** Name of the company, or the staff's for an invitation to the staff. */
  companyName: string;
  /**
   * Whether it's to a company or to the staff, whose name `companyName` then
   * holds: the email names it once (`InviteTarget`).
   */
  target: InviteTarget;
  /** The role they'll get. */
  role: Role;
  /** Link to accept the invitation. */
  url: string;
  /** How many days the link stays valid. */
  validDays: number;
}

/**
 * Says who invited the recipient, to which company and in which role (with
 * what that role can do), with a button to accept.
 */
export default function InvitationEmail({
  appUrl,
  inviterName,
  companyName,
  target,
  role,
  url,
  validDays,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: InvitationEmailProps) {
  const colours = emailColours(brand);
  const t = translator(locale, 'emails.invitation');
  const values = {
    inviter: inviterName,
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
      <EmailHeading colours={colours}>{t('heading', values)}</EmailHeading>
      <EmailParagraph colours={colours}>{t('body', values)}</EmailParagraph>
      <RoleSummary colours={colours} role={role} locale={locale} />
      <EmailButton colours={colours} href={url}>
        {t('button')}
      </EmailButton>
      <EmailNote colours={colours}>{t('note', { days: validDays })}</EmailNote>
      <LinkFallback colours={colours} url={url} locale={locale} />
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
InvitationEmail.PreviewProps = {
  ...PREVIEW_BASE,
  inviterName: 'Alex Doe',
  companyName: 'Adiutor',
  target: 'company',
  role: 'client',
  url: 'https://adiutor.dev/invite/example',
  validDays: 7,
} satisfies InvitationEmailProps;

/**
 * Builds the invitation email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function invitationEmail(to: string, props: InvitationEmailProps): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.invitation')('subject', {
      inviter: props.inviterName,
      company: props.companyName,
      target: props.target,
      staff: emailName(props.brand),
    }),
    <InvitationEmail {...props} />,
  );
}
