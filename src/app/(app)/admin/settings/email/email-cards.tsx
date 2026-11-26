/**
 * @file The mail server card of Settings' Connections tab (decision 0045),
 * for staff Admins: the mail server emails go out through and their sender.
 * While the server's environment chooses the mail server (`SMTP_URL`), the
 * card only shows it. Saving needs a recent confirmation, so the card has an
 * anchor (`#mail-server`) to come back to from the step-up page. It was the
 * Email tab, whose address now leads to this card (decision 0055).
 */
import { getTranslations } from 'next-intl/server';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Card from '@/components/ui/card';
import ClientMessages from '@/lib/i18n/client-messages';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { getSmtpSettings } from '@/server/smtp';

import EnvironmentMailServer from './environment-mail-server';
import MailServerForm from './mail-server-form';

/** Where the tab is, to come back to after confirming. */
const PATH = '/admin/settings/connections';

/**
 * The mail server card, with the saved mail server or the environment's.
 *
 * @returns The card.
 */
export default async function EmailSettingsCards() {
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
