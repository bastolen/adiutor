/**
 * @file The Webhooks tab of Settings, served at `/admin/settings/webhooks`:
 * the webhooks that send what happens to requests to the staff's own systems
 * and chat channels (decision 0046), and adding one. Staff Admins only
 * (`staff:manage`). The heading and tabs come from the Settings layout.
 */
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import { PageSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { listRequestTypes } from '@/server/requests';
import { listWebhooks } from '@/server/webhooks';

import WebhooksCard from './webhooks-card';

/**
 * Page metadata: "Webhooks · Settings · Adiutor" for those who may see the
 * page (`staff:manage`), and the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.settings.webhooks.title')
export const generateMetadata = globalPermissionMetadata(
  'staff:manage',
  'admin.settings.webhooks.title',
);

/**
 * Loads and shows the webhooks. Adding one needs a recent second step, so
 * the card asks for it before the dialog opens, and comes back to the card.
 * Its text comes from `admin.settings.webhooks`, which the dialog also gets
 * through `ClientMessages`.
 */
async function WebhookSettings() {
  const actor = await requireGlobalPermission('staff:manage');
  const [webhooks, types] = await Promise.all([
    listWebhooks(appContext, actor),
    listRequestTypes(appContext, actor),
  ]);
  return (
    <ClientMessages namespaces={['admin.settings.webhooks']}>
      <RecentConfirmationProvider
        required={actor.canConfirmSessions}
        returnTo="/admin/settings/webhooks"
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

/**
 * The Webhooks tab of Settings.
 */
export default function WebhookSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <WebhookSettings />
    </Suspense>
  );
}
