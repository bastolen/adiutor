/**
 * @file Email telling a staff Admin that a background job keeps failing: a
 * recurring job failed several runs in a row, or queued jobs were given up
 * after their last attempt. Sent at most once a day per job.
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
 * Props for {@link JobFailingEmail}.
 */
export interface JobFailingEmailProps extends EmailBaseProps {
  /** The job's name, or the kind of queued job, e.g. `invitation-reminders`. */
  job: string;
  /**
   * What went wrong: a recurring job failed `count` runs in a row
   * (`recurring`), or `count` queued jobs were given up (`queued`).
   */
  failure: 'recurring' | 'queued';
  /** How many runs in a row failed, or how many queued jobs were given up. */
  count: number;
  /** The reference of the last error it recorded, if it could. */
  reference: string | null;
  /** Link to the error under Logs → Errors (or to the errors, without a reference). */
  url: string;
}

/**
 * Names the job and what went wrong, gives the error's reference and links
 * to it under Logs → Errors.
 */
export default function JobFailingEmail({
  appUrl,
  job,
  failure,
  count,
  reference,
  url,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: JobFailingEmailProps) {
  const colours = emailColours(brand);
  const t = translator(locale, 'emails.jobFailing');
  return (
    <EmailLayout
      preview={t('subject', { job })}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      brand={brand}
      reason={t('reason')}
    >
      <EmailHeading colours={colours}>{t('heading', { job })}</EmailHeading>
      <EmailParagraph colours={colours}>
        {failure === 'recurring' ? t('recurring', { job, count }) : t('queued', { job, count })}
      </EmailParagraph>
      {reference && (
        <EmailParagraph colours={colours}>{t('reference', { reference })}</EmailParagraph>
      )}
      <EmailParagraph colours={colours}>{t('advice')}</EmailParagraph>
      <EmailButton colours={colours} href={url}>
        {t('button')}
      </EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
JobFailingEmail.PreviewProps = {
  ...PREVIEW_BASE,
  job: 'invitation-reminders',
  failure: 'recurring',
  count: 3,
  reference: '7KQ2-M9XD',
  url: 'https://adiutor.dev/admin/logs/errors?q=7KQ2-M9XD',
} satisfies JobFailingEmailProps;

/**
 * Builds the "job keeps failing" email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function jobFailingEmail(to: string, props: JobFailingEmailProps): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.jobFailing')('subject', { job: props.job }),
    <JobFailingEmail {...props} />,
  );
}
