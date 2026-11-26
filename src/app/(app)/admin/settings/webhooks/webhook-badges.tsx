/**
 * @file The badges of a webhook, on its list and its page: whether it's on
 * (or why it's off) and its format. Their text comes from
 * `admin.settings.webhooks`.
 */
import { useTranslations } from 'next-intl';

import Badge, { type BadgeTone } from '@/components/ui/badge';
import type { WebhookFormat, WebhookOffReason } from '@/lib/webhooks';

/** The tone of each state a webhook can be in: on, or off for a reason. */
const STATE_TONES: Readonly<Record<'on' | WebhookOffReason, BadgeTone>> = {
  on: 'success',
  manual: 'neutral',
  failing: 'danger',
  gone: 'danger',
  unreadable: 'danger',
};

/**
 * Whether a webhook is on, or why it's off: turned off by a staff Admin, or
 * by Adiutor because it kept failing, its receiver is gone or it can't be read.
 *
 * @param props - Component props.
 * @param props.on - Whether it's on.
 * @param props.offReason - Why it's off, while it is.
 */
export function WebhookStateBadge({
  on,
  offReason,
}: {
  on: boolean;
  offReason: WebhookOffReason | null;
}) {
  const t = useTranslations('admin.settings.webhooks.status');
  const state = on ? 'on' : (offReason ?? 'manual');
  return <Badge tone={STATE_TONES[state]}>{t(state)}</Badge>;
}

/**
 * How a webhook is sent: signed JSON or a chat message.
 *
 * @param props - Component props.
 * @param props.format - Its format.
 */
export function WebhookFormatBadge({ format }: { format: WebhookFormat }) {
  const t = useTranslations('admin.settings.webhooks.format');
  return <Badge>{t(format)}</Badge>;
}
