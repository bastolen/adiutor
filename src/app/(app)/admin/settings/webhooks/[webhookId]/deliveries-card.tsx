/**
 * @file The card with a webhook's deliveries, on its page: the last 30 days,
 * newest first, sorted and paginated (`WEBHOOK_DELIVERIES_TABLE`, the page's
 * main table), with what each told of, how it went and its attempts, and
 * Send again for a delivery that's over. Never what was sent, or what the
 * receiver answered. Its text comes from `admin.settings.webhooks`.
 */
import { Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import Badge, { type BadgeTone } from '@/components/ui/badge';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import { paginationFooter } from '@/components/ui/pagination';
import RelativeTime from '@/components/ui/relative-time';
import RowAction from '@/components/ui/row-action';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import TextLink from '@/components/ui/text-link';
import { formatDateTime } from '@/lib/format';
import { requestPath } from '@/lib/requests';
import type { TableLinks } from '@/lib/tables/page-url';
import type { Paged } from '@/lib/tables/table-state';
import type { WebhookDeliverySort } from '@/lib/tables/tables';
import type { WebhookDeliveryStatus } from '@/lib/webhooks';
import type { DeliveryView } from '@/server/webhooks';

import { resendDeliveryAction } from '../actions';

/** The tone of each status a delivery can have. */
const STATUS_TONES: Readonly<Record<WebhookDeliveryStatus, BadgeTone>> = {
  pending: 'warning',
  delivered: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

/** Props for {@link DeliveriesCard}. */
interface DeliveriesCardProps {
  /** The webhook's ID. */
  webhookId: string;
  /** Whether the webhook is on: only then can a delivery be sent again. */
  on: boolean;
  /** The page of deliveries to show. */
  deliveries: Paged<DeliveryView>;
  /** The table's links (sorts and pages). */
  table: TableLinks<WebhookDeliverySort>;
  /** The reader's time zone, for the next attempt's time and the one Send again is named with. */
  timeZone: string;
}

/**
 * How a delivery went: its status, and the receiver's last status or how
 * its last attempt failed.
 *
 * @param props - Component props.
 * @param props.delivery - The delivery.
 */
function Outcome({ delivery }: { delivery: DeliveryView }) {
  const t = useTranslations('admin.settings.webhooks');
  let detail: string | null = null;
  if (delivery.lastError) {
    detail = t(`outcome.${delivery.lastError}`, { status: delivery.lastStatus ?? 0 });
  } else if (delivery.lastStatus !== null) {
    detail = t('outcome.answered', { status: delivery.lastStatus });
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <Badge tone={STATUS_TONES[delivery.status]}>
        {t(`deliveries.status.${delivery.status}`)}
      </Badge>
      {detail && <span className="text-sm text-muted-foreground">{detail}</span>}
    </span>
  );
}

/**
 * The deliveries, or that there are none yet.
 */
export default function DeliveriesCard({
  webhookId,
  on,
  deliveries,
  table,
  timeZone,
}: DeliveriesCardProps) {
  const t = useTranslations('admin.settings.webhooks');
  const locale = useLocale();
  const list = new Intl.ListFormat(locale, { type: 'conjunction' });
  return (
    <Card
      id="deliveries"
      title={t('deliveries.title')}
      description={t('deliveries.description')}
      actions={
        deliveries.total > 0 && (
          <SortMenu label={t('deliveries.rows')} options={table.sortOptions()} />
        )
      }
      flush={deliveries.total > 0}
      footer={paginationFooter(table, deliveries, t('deliveries.rows'))}
    >
      {deliveries.total === 0 ? (
        <EmptyState
          icon={Send}
          title={t('deliveries.emptyTitle')}
          description={t('deliveries.emptyDescription')}
        />
      ) : (
        <Table caption={table.caption(t('deliveries.caption'), deliveries)}>
          <thead>
            <tr>
              <Th>{t('deliveries.what')}</Th>
              <Th aria-sort={table.ariaSort('time')} className="hidden sm:table-cell">
                {t('deliveries.when')}
              </Th>
              <Th className="hidden md:table-cell">{t('deliveries.result')}</Th>
              <Th className="hidden lg:table-cell">{t('deliveries.attempts')}</Th>
              <Th>
                <span className="sr-only">{t('deliveries.actions')}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {deliveries.items.map((delivery) => {
              const attempts = (
                <span className="flex flex-col gap-0.5">
                  <span>{t('deliveries.attemptCount', { count: delivery.attempts })}</span>
                  {delivery.status === 'pending' && delivery.nextAttemptAt && (
                    <span className="text-xs">
                      {t('deliveries.nextAttempt', {
                        time: formatDateTime(delivery.nextAttemptAt, locale, timeZone),
                      })}
                    </span>
                  )}
                </span>
              );
              const canResend = on && !delivery.test && delivery.status !== 'pending';
              return (
                <Tr key={delivery.id}>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-sm font-medium text-foreground">
                        {delivery.test
                          ? t('deliveries.test')
                          : list.format(delivery.events.map((event) => t(`events.${event}`)))}
                      </span>
                      {delivery.request && (
                        <TextLink href={requestPath(delivery.request.number)} className="text-sm">
                          {delivery.request.reference}
                        </TextLink>
                      )}
                      {/* Below the wider widths, when and how it went go here. */}
                      <span className="text-xs text-muted-foreground sm:hidden">
                        <RelativeTime date={delivery.createdAt} />
                      </span>
                      <span className="md:hidden">
                        <Outcome delivery={delivery} />
                      </span>
                      <span className="text-sm text-muted-foreground lg:hidden">{attempts}</span>
                    </div>
                  </Td>
                  <Td className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                    <RelativeTime date={delivery.createdAt} spokenExact />
                  </Td>
                  <Td className="hidden md:table-cell">
                    <Outcome delivery={delivery} />
                  </Td>
                  <Td className="hidden text-sm text-muted-foreground lg:table-cell">{attempts}</Td>
                  <Td className="text-end">
                    {canResend && (
                      <RowAction
                        action={resendDeliveryAction}
                        fields={{ webhook: webhookId, delivery: delivery.id }}
                        label={t('deliveries.resend')}
                        ariaLabel={t('deliveries.resendLabel', {
                          time: formatDateTime(delivery.createdAt, locale, timeZone),
                        })}
                        variant="ghost"
                      />
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
