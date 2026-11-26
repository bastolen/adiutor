/**
 * @file A webhook's page, served at `/admin/settings/webhooks/[webhookId]`,
 * with the Connections tab of Settings current (its webhooks card lists
 * them): its details and controls, and its
 * deliveries of the last 30 days. Staff Admins only (`staff:manage`); a
 * webhook that isn't there is the 404 page.
 */
import { notFound } from 'next/navigation';
import { getTimeZone, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import { PageSkeleton } from '@/components/ui/skeleton';
import TextLink from '@/components/ui/text-link';
import ClientMessages from '@/lib/i18n/client-messages';
import type { SearchParams } from '@/lib/search-params';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState } from '@/lib/tables/table-state';
import { WEBHOOK_DELIVERIES_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { listRequestTypes } from '@/server/requests';
import { getWebhook, listDeliveries } from '@/server/webhooks';

import DeliveriesCard from './deliveries-card';
import WebhookDetailsCard from './webhook-details-card';

/**
 * Page metadata: "Webhook · Settings · Adiutor" for those who may see the
 * page (`staff:manage`), and the 404 page's title for everyone else. The
 * title never names the webhook, as a browser's history is read by others.
 */
// i18n-check t('admin.settings.webhooks.page.title')
export const generateMetadata = globalPermissionMetadata(
  'staff:manage',
  'admin.settings.webhooks.page.title',
);

/**
 * Runs a lookup, showing the 404 page when what it looks for isn't there.
 *
 * @param lookup - The lookup.
 * @returns What it found.
 */
async function orNotFound<T>(lookup: Promise<T>): Promise<T> {
  try {
    return await lookup;
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'not_found') {
      notFound();
    }
    throw error;
  }
}

/**
 * Loads and shows the webhook. Editing it, renewing its secret and turning
 * it on need a recent second step, which its controls ask for first, coming
 * back to their card.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters: the deliveries table's state.
 */
async function WebhookSettings({
  params,
  searchParams,
}: {
  params: Promise<{ webhookId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const t = await getTranslations('admin.settings.webhooks.page');
  const actor = await requireGlobalPermission('staff:manage');
  const { webhookId } = await params;
  const query = await searchParams;
  const requested = parseTableState(WEBHOOK_DELIVERIES_TABLE, query);
  const [webhook, deliveries, types, timeZone] = await Promise.all([
    orNotFound(getWebhook(appContext, actor, { webhook: webhookId })),
    orNotFound(listDeliveries(appContext, actor, { webhook: webhookId }, requested)),
    listRequestTypes(appContext, actor),
    getTimeZone(),
  ]);
  const url = createPageUrl(
    `/admin/settings/webhooks/${encodeURIComponent(webhook.id)}`,
    {},
    await getTranslations('tables'),
  );
  const table = url.table(WEBHOOK_DELIVERIES_TABLE, { ...requested, page: deliveries.page });
  return (
    <ClientMessages namespaces={['admin.settings.webhooks']}>
      <RecentConfirmationProvider
        required={actor.canConfirmSessions}
        // The page with its table; each control adds its card's anchor.
        returnTo={url.current()}
        {...confirmationWindow(actor.mfaConfirmedUntil)}
      >
        <TextLink href="/admin/settings/connections#webhooks" className="self-start text-sm">
          {t('back')}
        </TextLink>
        <WebhookDetailsCard
          webhook={webhook}
          types={types.map(({ key, name, archived }) => ({ key, name, archived }))}
        />
        <DeliveriesCard
          webhookId={webhook.id}
          on={webhook.on}
          deliveries={deliveries}
          table={table}
          timeZone={timeZone}
        />
      </RecentConfirmationProvider>
    </ClientMessages>
  );
}

/**
 * A webhook's page.
 */
export default function WebhookPage({
  params,
  searchParams,
}: PageProps<'/admin/settings/webhooks/[webhookId]'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <WebhookSettings params={params} searchParams={searchParams} />
    </Suspense>
  );
}
