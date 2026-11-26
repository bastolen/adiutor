/**
 * @file The card with a webhook's details, on its page: where it sends and
 * what, whether it's on (and why not), and the buttons to edit it, send a
 * test, turn it off or on, renew its secret and remove it. Its text comes
 * from `admin.settings.webhooks` (the dialogs' through `ClientMessages`).
 */
import { useLocale, useTranslations } from 'next-intl';

import Alert from '@/components/ui/alert';
import Card from '@/components/ui/card';
import { DescriptionList, DescriptionRow } from '@/components/ui/description-list';
import RelativeTime from '@/components/ui/relative-time';
import RowAction from '@/components/ui/row-action';
import type { WebhookView } from '@/server/webhooks';

import { removeWebhookAction, sendTestEventAction, setWebhookOnAction } from '../actions';
import { WebhookFormatBadge, WebhookStateBadge } from '../webhook-badges';
import type { WebhookTypeChoice } from '../webhook-fields';
import EditWebhookDialog from './edit-webhook-dialog';
import RenewSecretDialog from './renew-secret-dialog';

/** Props for {@link WebhookDetailsCard}. */
interface WebhookDetailsCardProps {
  /** The webhook. */
  webhook: WebhookView;
  /** The request types, in order, for the names of its types and the edit dialog. */
  types: readonly WebhookTypeChoice[];
}

/**
 * The details, with a note on why a webhook that's off is off. Turning it
 * on, editing it and renewing its secret need a recent second step, so they
 * ask for it first; turning it off and removing it don't. Removing asks, then
 * goes back to the list.
 */
export default function WebhookDetailsCard({ webhook, types }: WebhookDetailsCardProps) {
  const t = useTranslations('admin.settings.webhooks');
  const locale = useLocale();
  const list = new Intl.ListFormat(locale, { type: 'conjunction' });
  const typeNames = new Map(types.map(({ key, name }) => [key, name]));
  const fields = { webhook: webhook.id };

  return (
    <Card
      id="webhook"
      title={webhook.name}
      description={t('page.detailsDescription')}
      actions={
        <span className="flex flex-wrap items-center gap-2">
          <WebhookStateBadge on={webhook.on} offReason={webhook.offReason} />
          <WebhookFormatBadge format={webhook.format} />
        </span>
      }
    >
      <div className="flex flex-col gap-5">
        {!webhook.on && (
          <Alert tone="info">{t('page.offNote', { reason: webhook.offReason ?? 'manual' })}</Alert>
        )}
        <DescriptionList>
          <DescriptionRow term={t('page.host')}>
            <span className="wrap-anywhere">{webhook.host}</span>
          </DescriptionRow>
          <DescriptionRow term={t('page.format')}>{t(`format.${webhook.format}`)}</DescriptionRow>
          <DescriptionRow term={t('page.types')}>
            {webhook.allTypes
              ? t('allTypes')
              : list.format(webhook.types.map((key) => typeNames.get(key) ?? key))}
          </DescriptionRow>
          <DescriptionRow term={t('page.events')}>
            {list.format(webhook.events.map((event) => t(`events.${event}`)))}
          </DescriptionRow>
          <DescriptionRow term={t('page.added')}>
            <RelativeTime date={webhook.createdAt} />
          </DescriptionRow>
          <DescriptionRow term={t('page.secretRenewed')}>
            {webhook.secretRenewedAt ? (
              <RelativeTime date={webhook.secretRenewedAt} />
            ) : (
              t('page.never')
            )}
          </DescriptionRow>
          {webhook.failingSince && (
            <DescriptionRow term={t('page.failingSince')}>
              <RelativeTime date={webhook.failingSince} />
            </DescriptionRow>
          )}
        </DescriptionList>
        <div className="flex flex-wrap items-center gap-2">
          <EditWebhookDialog
            id={webhook.id}
            webhook={{
              name: webhook.name,
              format: webhook.format,
              events: webhook.events,
              allTypes: webhook.allTypes,
              types: webhook.types,
            }}
            types={types}
          />
          <RowAction action={sendTestEventAction} fields={fields} label={t('test.button')} />
          {webhook.on ? (
            <RowAction
              action={setWebhookOnAction}
              fields={{ ...fields, on: 'false' }}
              label={t('onOff.turnOff')}
            />
          ) : (
            <RowAction
              action={setWebhookOnAction}
              fields={{ ...fields, on: 'true' }}
              label={t('onOff.turnOn')}
              confirmFirst
            />
          )}
          <RenewSecretDialog id={webhook.id} />
          <RowAction
            action={removeWebhookAction}
            fields={fields}
            label={t('remove.button')}
            variant="danger-subtle"
            confirm={{
              title: t('remove.title', { name: webhook.name }),
              description: t('remove.description'),
              confirmLabel: t('remove.confirm'),
            }}
          />
        </div>
      </div>
    </Card>
  );
}
