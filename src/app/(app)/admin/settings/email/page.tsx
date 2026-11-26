/**
 * @file The Email tab of Settings (decision 0045), for staff Admins: the
 * mail server emails go out through and their sender. While the server's
 * environment chooses the mail server (`SMTP_URL`), the card only shows it.
 * Saving needs a recent confirmation, so the card has an anchor
 * (`#mail-server`) to come back to from the step-up page.
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
import { getSmtpSettings } from '@/server/smtp';

import EnvironmentMailServer from './environment-mail-server';
import MailServerForm from './mail-server-form';

/** Where the tab is, to come back to after confirming. */
const PATH = '/admin/settings/email';

// i18n-check t('admin.settings.email.title')
/** The page title, for staff Admins only. */
export const generateMetadata = globalPermissionMetadata(
  'staff:manage',
  'admin.settings.email.title',
);

/**
 * The tab's card, with the saved mail server or the environment's.
 *
 * @returns The card.
 */
async function EmailSettingsCards() {
  const t = await getTranslations('admin.settings.email');
  const actor = await requireGlobalPermission('staff:manage');
  const settings = await getSmtpSettings(appContext, actor);
  const { server } = settings;
  return (
    <ClientMessages namespaces={['admin.settings.email']}>
      <RecentConfirmationProvider
        required={actor.canConfirmSessions}
        returnTo={PATH}
        {...confirmationWindow(actor.mfaConfirmedUntil)}
      >
        <Card id="mail-server" title={t('server.title')} description={t('server.description')}>
          {server.source === 'environment' ? (
            <EnvironmentMailServer view={server.view} sender={settings.senderInUse} />
          ) : (
            <MailServerForm
              current={server.view}
              environmentSender={settings.environmentSender}
              production={settings.production}
            />
          )}
        </Card>
      </RecentConfirmationProvider>
    </ClientMessages>
  );
}

/**
 * The Email tab.
 *
 * @returns The page.
 */
export default function EmailSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <EmailSettingsCards />
    </Suspense>
  );
}
