/**
 * @file The webhooks card of Settings' Connections tab: the webhooks that
 * send what happens to requests to the staff's own systems and chat channels
 * (decision 0046), and adding one; each webhook's page stays at
 * `/admin/settings/webhooks/[webhookId]`. Staff Admins only
 * (`staff:manage`). It was the Webhooks tab, whose address now leads to this
 * card (decision 0055).
 */
import { getTranslations } from 'next-intl/server';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import ToastOnArrival from '@/components/ui/toast-on-arrival';
import ClientMessages from '@/lib/i18n/client-messages';
import type { SearchParams } from '@/lib/search-params';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { listRequestTypes } from '@/server/requests';
import { listWebhooks } from '@/server/webhooks';

import WebhooksCard from './webhooks-card';

/**
 * Loads and shows the webhooks. Adding one needs a recent second step, so
 * the card asks for it before the dialog opens, and comes back to the card.
 * Its text comes from `admin.settings.webhooks`, which the dialog also gets
 * through `ClientMessages`. Coming back from removing a webhook
 * (`?removed=1`), a toast says so.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: `removed`.
 */
export default async function WebhookSettings({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const t = await getTranslations('admin.settings.webhooks');
  const actor = await requireGlobalPermission('staff:manage');
  const { removed } = await searchParams;
  const [webhooks, types] = await Promise.all([
    listWebhooks(appContext, actor),
    listRequestTypes(appContext, actor),
  ]);
  return (
    <ClientMessages namespaces={['admin.settings.webhooks']}>
      {removed && <ToastOnArrival message={t('removedToast')} param="removed" />}
      <RecentConfirmationProvider
        required={actor.canConfirmSessions}
        returnTo="/admin/settings/connections"
        {...confirmationWindow(actor.mfaConfirmedUntil)}
      >
        <WebhooksCard
          webhooks={webhooks}
          types={types.map(({ key, name, archived }) => ({ key, name, archived }))}
        />
      </RecentConfirmationProvider>
    </ClientMessages>
  );
}
