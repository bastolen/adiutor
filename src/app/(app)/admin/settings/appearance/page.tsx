/**
 * @file The Appearance tab of Settings, served at `/admin/settings/appearance`:
 * the brand colours every page and email shows (decision 0049). Platform
 * Admins only (`staff:manage`). The heading and tabs come from the Settings
 * layout.
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Card from '@/components/ui/card';
import { PageSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { getBrandColours } from '@/server/branding';
import { globalPermissionMetadata } from '@/server/page-metadata';

import ColoursForm from './colours-form';

/**
 * Page metadata: "Appearance · Settings · Adiutor" for those who may see the
 * page (`staff:manage`), and the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.settings.appearance.title')
export const generateMetadata = globalPermissionMetadata(
  'staff:manage',
  'admin.settings.appearance.title',
);

/**
 * Loads and shows the brand colours. Its text comes from
 * `admin.settings.appearance`, which `ColoursForm` also gets through
 * `ClientMessages`.
 */
async function AppearanceSettings() {
  const t = await getTranslations('admin.settings.appearance.colours');
  const actor = await requireGlobalPermission('staff:manage');
  const colours = await getBrandColours(appContext, actor);
  return (
    <ClientMessages namespaces={['admin.settings.appearance']}>
      <Card id="colours" title={t('title')} description={t('description')}>
        <ColoursForm saved={colours} />
      </Card>
    </ClientMessages>
  );
}

/**
 * The Appearance tab of Settings.
 */
export default function AppearanceSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <AppearanceSettings />
    </Suspense>
  );
}
