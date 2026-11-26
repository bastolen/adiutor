/**
 * @file Email telling a staff Admin that a webhook was turned off
 * automatically: its deliveries failed for days, its receiver said it's
 * gone, or its address or secret can't be read any more. Names the webhook
 * and why, never its address, and links to the webhook in Settings. Its
 * text says "turned off automatically" rather than naming who did it: the
 * staff's name (decision 0050) would read as if someone on the staff had.
 */
import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import { EmailHeading, EmailParagraph } from '@/components/email/email-text';
import { emailColours, emailName } from '@/components/email/theme';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';
import { WEBHOOK_FAILING_DAYS } from '@/lib/webhooks';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/**
 * Props for {@link WebhookTurnedOffEmail}.
 */
export interface WebhookTurnedOffEmailProps extends EmailBaseProps {
  /** The webhook's name. */
  name: string;
  /**
   * Why it was turned off: its deliveries failed for days (`failing`),
   * its receiver answered `410 Gone` (`gone`), or its address or secret
   * can't be read with the current auth secrets (`unreadable`).
   */
  reason: 'failing' | 'gone' | 'unreadable';
  /** Link to the webhook in Settings. */
  url: string;
}

/**
 * Says which webhook is off and why, what that means and what to do, with a
 * link to the webhook.
 */
export default function WebhookTurnedOffEmail({
  appUrl,
  name,
  reason,
  url,
  locale,
  logoSrc = undefined,
  brand = undefined,
}: WebhookTurnedOffEmailProps) {
  const t = translator(locale, 'emails.webhookTurnedOff');
  const colours = emailColours(brand);
  return (
    <EmailLayout
      preview={t('subject', { name })}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      brand={brand}
      reason={t('reason', { staff: emailName(brand) })}
    >
      <EmailHeading colours={colours}>{t('heading', { name })}</EmailHeading>
      <EmailParagraph colours={colours}>
        {t('why', { reason, days: WEBHOOK_FAILING_DAYS })}
      </EmailParagraph>
      <EmailParagraph colours={colours}>
        {reason === 'unreadable' ? t('adviceUnreadable') : t('advice')}
      </EmailParagraph>
      <EmailButton colours={colours} href={url}>
        {t('button')}
      </EmailButton>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
WebhookTurnedOffEmail.PreviewProps = {
  ...PREVIEW_BASE,
  name: 'Procurement',
  reason: 'failing',
  url: 'https://adiutor.dev/admin/settings/webhooks/019abcde-0000-7000-8000-000000000001',
} satisfies WebhookTurnedOffEmailProps;

/**
 * Builds the "a webhook was turned off" email.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function webhookTurnedOffEmail(
  to: string,
  props: WebhookTurnedOffEmailProps,
): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.webhookTurnedOff')('subject', { name: props.name }),
    <WebhookTurnedOffEmail {...props} />,
  );
}
