/**
 * @file The Integrations tab of Settings, served at
 * `/admin/settings/integrations`: what Adiutor works with outside itself.
 * First the mail server emails go out through (`../email/`), then the
 * Attachments card: whether people can attach files, the largest one and
 * where they're kept (`../attachments/`), then the webhooks (`../webhooks/`,
 * whose pages keep their own address, with this tab current there). Staff
 * Admins only (`staff:manage`). The heading and tabs come from the Settings layout;
 * decision 0055 says which settings go on this tab.
 */
import { Suspense } from 'react';

import { PageSkeleton } from '@/components/ui/skeleton';
import { globalPermissionMetadata } from '@/server/page-metadata';

import AttachmentSettingsCards from '../attachments/attachment-cards';
import EmailSettingsCards from '../email/email-cards';
// eslint-disable-next-line no-restricted-imports -- Settings' route folder, not the `server/webhooks` module the rule guards.
import WebhookSettings from '../webhooks/webhook-cards';

/**
 * Page metadata: "Integrations · Settings · Adiutor" for those who may see
 * the page (`staff:manage`), and the 404 page's title for everyone else, who
 * get the 404 page.
 */
// i18n-check t('admin.settings.integrations.title')
export const generateMetadata = globalPermissionMetadata(
  'staff:manage',
  'admin.settings.integrations.title',
);

/**
 * The Integrations tab of Settings: the mail server, Attachments and webhook
 * cards, which load side by side. The mail server and webhook cards show
 * together; the Attachments card has a boundary of its own, since
 * checking an SFTP storage opens a connection to another server, which the
 * other cards shouldn't wait for. Each checks the permission itself.
 *
 * @param props - Page props.
 * @param props.searchParams - Query parameters: `removed`, after a webhook
 *   was removed on its page.
 */
export default function ConnectionsSettingsPage({
  searchParams,
}: PageProps<'/admin/settings/integrations'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <EmailSettingsCards />
      <Suspense fallback={<PageSkeleton header={false} />}>
        <AttachmentSettingsCards />
      </Suspense>
      <WebhookSettings searchParams={searchParams} />
    </Suspense>
  );
}
