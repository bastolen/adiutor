/**
 * @file The Connections tab of Settings, served at
 * `/admin/settings/connections`: what Adiutor connects to outside itself.
 * First the mail server emails go out through (`../email/`), then where
 * attached files are kept, whether people can attach them and the largest
 * one (`../attachments/`), then the webhooks (`../webhooks/`, whose pages
 * keep their own address, with this tab current there). Staff Admins only
 * (`staff:manage`). The heading and tabs come from the Settings layout;
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
 * Page metadata: "Connections · Settings · Adiutor" for those who may see
 * the page (`staff:manage`), and the 404 page's title for everyone else, who
 * get the 404 page.
 */
// i18n-check t('admin.settings.connections.title')
export const generateMetadata = globalPermissionMetadata(
  'staff:manage',
  'admin.settings.connections.title',
);

/**
 * The Connections tab of Settings: the mail server, attachment and webhook
 * cards, which load side by side and show together. Each checks the
 * permission itself.
 *
 * @param props - Page props.
 * @param props.searchParams - Query parameters: `removed`, after a webhook
 *   was removed on its page.
 */
export default function ConnectionsSettingsPage({
  searchParams,
}: PageProps<'/admin/settings/connections'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <EmailSettingsCards />
      <AttachmentSettingsCards />
      <WebhookSettings searchParams={searchParams} />
    </Suspense>
  );
}
