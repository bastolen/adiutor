/**
 * @file The card of webhooks on Settings' Integrations tab: each webhook
 * with whether it's on, its format, where it sends and what, and the button
 * to add one. Its text comes from `admin.settings.webhooks` (the dialog's
 * through `ClientMessages`).
 */
import { Webhook } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import TextLink from '@/components/ui/text-link';
import type { WebhookView } from '@/server/webhooks';

import AddWebhookDialog from './add-webhook-dialog';
import { WebhookFormatBadge, WebhookStateBadge } from './webhook-badges';
import type { WebhookTypeChoice } from './webhook-fields';

/** Props for {@link WebhooksCard}. */
interface WebhooksCardProps {
  /** Every webhook, by name. */
  webhooks: readonly WebhookView[];
  /** The request types, in order, for the names of the types a webhook covers and the form. */
  types: readonly WebhookTypeChoice[];
}

/**
 * The card. Webhooks are a short list the staff name, so they're a list
 * rather than a table that sorts and pages. Each shows its name (a link to
 * its page, with its deliveries and controls), whether
 * it's on (or why it's off), its format, the host it sends to (never its
 * address), the types it covers and the events it sends.
 */
export default function WebhooksCard({ webhooks, types }: WebhooksCardProps) {
  const t = useTranslations('admin.settings.webhooks');
  const locale = useLocale();
  const list = new Intl.ListFormat(locale, { type: 'conjunction' });
  const typeNames = new Map(types.map(({ key, name }) => [key, name]));

  return (
    <Card
      id="webhooks"
      title={t('card.title')}
      description={t('card.description')}
      actions={<AddWebhookDialog types={types} />}
    >
      {webhooks.length === 0 ? (
        <EmptyState icon={Webhook} title={t('card.empty')} />
      ) : (
        <ul aria-label={t('card.listLabel')} className="-my-3 divide-y divide-border">
          {webhooks.map((webhook) => (
            <li key={webhook.id} className="flex min-w-0 flex-col gap-1 py-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium wrap-anywhere text-foreground">
                <TextLink href={`/admin/settings/webhooks/${encodeURIComponent(webhook.id)}`}>
                  {webhook.name}
                </TextLink>
                <WebhookStateBadge on={webhook.on} offReason={webhook.offReason} />
                <WebhookFormatBadge format={webhook.format} />
              </p>
              <p className="text-sm wrap-anywhere text-muted-foreground">
                {t('summary', {
                  host: webhook.host,
                  types: webhook.allTypes
                    ? t('allTypes')
                    : list.format(webhook.types.map((key) => typeNames.get(key) ?? key)),
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {list.format(webhook.events.map((event) => t(`events.${event}`)))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
