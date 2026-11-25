/**
 * @file The Attachments tab of Settings, served at
 * `/admin/settings/attachments`: where files people attach are kept, and
 * the largest file anyone may attach (decision 0044). Each is chosen here
 * unless the server's environment chooses it, which this page then only
 * shows. Staff Admins only (`staff:manage`). The heading and tabs come from
 * the Settings layout.
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Card from '@/components/ui/card';
import { PageSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { getAttachmentSettings } from '@/server/storage';

import EnvironmentStorage from './environment-storage';
import LargestFileForm from './largest-file-form';
import StorageForm from './storage-form';

/** The page's address, which the step-up page comes back to. */
const PATH = '/admin/settings/attachments';

/**
 * Page metadata: "Attachments · Settings · Adiutor" for those who may see the
 * page (`staff:manage`), and the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.settings.attachments.title')
export const generateMetadata = globalPermissionMetadata(
  'staff:manage',
  'admin.settings.attachments.title',
);

/**
 * Loads and shows the attachment settings. Their text comes from
 * `admin.settings.attachments`, which the forms also get through `ClientMessages`.
 */
async function AttachmentSettingsCards() {
  const t = await getTranslations('admin.settings.attachments');
  const actor = await requireGlobalPermission('staff:manage');
  const settings = await getAttachmentSettings(appContext, actor);
  const { storage, maxFileMb } = settings;
  return (
    <ClientMessages namespaces={['admin.settings.attachments']}>
      <RecentConfirmationProvider
        required={actor.canConfirmSessions}
        returnTo={PATH}
        {...confirmationWindow(actor.mfaConfirmedUntil)}
      >
        <Card id="storage" title={t('storage.title')} description={t('storage.description')}>
          {storage.source === 'environment' ? (
            <EnvironmentStorage view={storage.view} />
          ) : (
            <StorageForm current={storage.view} vercel={settings.vercel} />
          )}
        </Card>

        <Card
          id="largest-file"
          title={t('largestFile.title')}
          description={t('largestFile.description')}
        >
          <LargestFileForm
            value={maxFileMb.value}
            ceiling={maxFileMb.ceiling}
            locked={maxFileMb.fromEnvironment}
          />
        </Card>
      </RecentConfirmationProvider>
    </ClientMessages>
  );
}

/**
 * The Attachments tab of Settings.
 */
export default function AttachmentSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <AttachmentSettingsCards />
    </Suspense>
  );
}
