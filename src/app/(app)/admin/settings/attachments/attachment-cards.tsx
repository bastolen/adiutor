/**
 * @file The attachment cards of Settings' Integrations tab: where files
 * people attach are kept, whether people can attach files, and the largest
 * file anyone may attach (decision 0044). Each is chosen here unless the
 * server's environment chooses it, which the card then only shows. Staff
 * Admins only (`staff:manage`). They were the Attachments tab, whose address
 * now leads to the storage's card (decision 0055).
 */
import { getTranslations } from 'next-intl/server';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Card from '@/components/ui/card';
import ClientMessages from '@/lib/i18n/client-messages';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { getAttachmentSettings } from '@/server/storage';

import AttachingForm from './attaching-form';
import EnvironmentStorage from './environment-storage';
import LargestFileForm from './largest-file-form';
import StorageForm from './storage-form';

/** The tab's address, which the step-up page comes back to. */
const PATH = '/admin/settings/integrations';

/**
 * Loads and shows the attachment settings. Their text comes from
 * `admin.settings.attachments`, which the forms also get through `ClientMessages`.
 */
export default async function AttachmentSettingsCards() {
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
            <EnvironmentStorage view={storage.view} setUp={settings.storageSetUp} />
          ) : (
            <StorageForm
              current={storage.view}
              vercel={settings.vercel}
              setUp={settings.storageSetUp}
            />
          )}
        </Card>

        <Card id="attaching" title={t('attaching.title')} description={t('attaching.description')}>
          <AttachingForm
            on={settings.enabled.value}
            storageChosen={settings.enabled.storageChosen}
            offByEnvironment={settings.enabled.offByEnvironment}
          />
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
