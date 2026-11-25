/**
 * @file The Requests tab of Settings, served at `/admin/settings/requests`:
 * the prefix request numbers are shown with, and the request types companies
 * pick from. Platform Admins only (`staff:manage`). The heading and tabs come
 * from the Settings layout.
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Card from '@/components/ui/card';
import { PageSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { getStaffSettings } from '@/server/people/staff';
import { listRequestTypes } from '@/server/requests';

import RequestPrefixForm from './request-prefix-form';
import RequestTypesCard from './request-types-card';

/**
 * Page metadata: "Requests · Settings · Adiutor" for those who may see the
 * page (`staff:manage`), and the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.settings.requests.title')
export const generateMetadata = globalPermissionMetadata(
  'staff:manage',
  'admin.settings.requests.title',
);

/**
 * Loads and shows the request settings. Its text comes from
 * `admin.settings.requests`, which `RequestPrefixForm` and the request type
 * dialog also get through `ClientMessages`.
 */
async function RequestSettings() {
  const t = await getTranslations('admin.settings.requests');
  const actor = await requireGlobalPermission('staff:manage');
  const [settings, types] = await Promise.all([
    getStaffSettings(appContext, actor),
    listRequestTypes(appContext, actor),
  ]);
  return (
    <ClientMessages namespaces={['admin.settings.requests']}>
      <Card title={t('requestNumbers.title')} description={t('requestNumbers.description')}>
        <RequestPrefixForm prefix={settings.requestPrefix} />
      </Card>

      <RequestTypesCard types={types} />
    </ClientMessages>
  );
}

/**
 * The Requests tab of Settings.
 */
export default function RequestSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <RequestSettings />
    </Suspense>
  );
}
