/**
 * @file The Security page of the account, served at `/account/security`:
 * passkeys, two-step verification, connected provider accounts,
 * password, signed-in devices and deactivating the account. Users whose role
 * requires MFA are sent here until they've set it up (a passkey or an
 * authenticator app; email codes don't count for them). Changing how they
 * sign in, and deactivating the account, needs a confirmation with their
 * second step from the last 15 minutes; starting a change without one sends
 * them to the step-up page first (`RecentConfirmationProvider`), which comes
 * back to the card they started in (its anchor, e.g. `#passkeys`), as does
 * connecting GitHub or Google (`#connected-accounts`, where the card says how
 * it went).
 */
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Alert from '@/components/ui/alert';
import Card from '@/components/ui/card';
import { PageSkeleton } from '@/components/ui/skeleton';
import {
  emailCodeStatus,
  mfaDowngradeBlocks,
  mfaGivingProviders,
  mustSetUpMfa,
} from '@/lib/authz/mfa';
import ClientMessages from '@/lib/i18n/client-messages';
import type { SearchParams } from '@/lib/search-params';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import { providerList } from '@/lib/sign-in/oauth-providers';
import { availableProviders, signInProviders } from '@/lib/sign-in/providers';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState } from '@/lib/tables/table-state';
import { DEVICES_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { listConnectedProviders } from '@/server/auth/accounts';
import { getSecurityOverview } from '@/server/auth/security';
import { getActor } from '@/server/authz';
import { serviceErrorMessage } from '@/server/errors';
import { listUserSessions, soleAdminError, soleAdminOf } from '@/server/people/user-admin';

import accountMessage from '../account-messages';
import ConnectedAccountsCard from './connected-accounts-card';
import DeactivateCard from './deactivate-card';
import PasskeysCard from './passkeys-card';
import PasswordForm from './password-form';
import SessionsCard from './sessions-card';
import TwoFactorCard from './two-factor-card';

/**
 * Page metadata: "Security", in the request's language.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account');
  return { title: t('security.title') };
}

/**
 * Loads the user's security settings and shows them.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: set after connecting GitHub or Google
 *   (`AccountParams`), and the signed-in devices' sort and page (see `DEVICES_TABLE`).
 * @returns The page content.
 */
async function Security({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getActor({ allowMissingMfa: true });
  const [params, t, tAuth, locale] = await Promise.all([
    searchParams,
    getTranslations('account'),
    getTranslations('auth'),
    getLocale(),
  ]);
  const devicesRequested = parseTableState(DEVICES_TABLE, params);
  const [overview, connected, sessions, lastAdminOf] = await Promise.all([
    getSecurityOverview(appContext, actor),
    listConnectedProviders(appContext, actor.id),
    listUserSessions(appContext, actor.id, actor.mfaRole, devicesRequested),
    // Only shown: deactivating checks again, with locks, in its own transaction.
    soleAdminOf(appContext.db, actor.id, { lock: false }),
  ]);
  // Built from the table's own state only, so a sort doesn't bring back `?connected=…`.
  const url = createPageUrl('/account/security', {}, await getTranslations('tables'));
  const devicesTable = url.table(DEVICES_TABLE, {
    ...devicesRequested,
    page: sessions.page,
  });
  const message = accountMessage(t, tAuth, params);
  // The same check that sent them here (`getActor`).
  const mustSetUp = mustSetUpMfa(actor);
  const setup = {
    authenticator: overview.mfaState.authenticator,
    passkeyCount: overview.passkeys.length,
  };
  // Accounts connected at sign-in are judged with the MFA their provider gave (stored at that
  // sign-in), which the card doesn't need: it stays on the server.
  const unconfirmed = connected
    .filter((link) => !link.confirmed)
    .map(({ id, provider, mfaVerified }) => ({ id, providerId: provider, mfaVerified }));
  const links = connected.map(({ mfaVerified, ...link }) => link);
  // Changes that would take away the MFA the user's role requires (the guards and services refuse
  // them too).
  const blocked = mfaDowngradeBlocks(
    overview.mfaState,
    actor.mfaRole,
    availableProviders,
    unconfirmed,
  );
  const giving = providerList(mfaGivingProviders(overview.mfaState, availableProviders), locale);
  // Shown where a password or another connected account would stop provider MFA counting as the
  // MFA a role requires.
  const providerMfaOnly = t('security.providerMfaOnly', { providers: giving });
  // Why deactivating is refused while the user is the last Admin of something.
  const soleAdmin = soleAdminError('self', lastAdminOf);

  // After connecting GitHub or Google, the Connected accounts card says how it went.
  const showsConnectedAccounts = signInProviders.length > 0;

  return (
    <>
      {message && !showsConnectedAccounts && (
        <Alert tone={message.tone} focusOnShow>
          {message.text}
        </Alert>
      )}
      {mustSetUp && (
        <Alert tone="info" focusOnShow>
          {t('security.mustSetUp', {
            emailCodes: overview.mfaState.twoFactorEnabled ? 'true' : 'false',
          })}
        </Alert>
      )}
      {!actor.mfaEnabled && !actor.mfaRequired && (
        <Alert tone="info">{t('security.recommended')}</Alert>
      )}
      <RecentConfirmationProvider
        required={actor.canConfirmSessions}
        // The page with its devices table; each control adds its card's anchor.
        returnTo={url.current()}
        {...confirmationWindow(actor.mfaConfirmedUntil)}
      >
        <PasskeysCard
          passkeys={overview.passkeys}
          removeLastBlockedReason={blocked.lastPasskey ? t('security.keepLastPasskey') : null}
        />
        <TwoFactorCard
          email={actor.email}
          enabled={overview.mfaState.twoFactorEnabled}
          authenticatorSetUp={overview.mfaState.authenticator}
          emailCodes={emailCodeStatus(setup, actor.mfaRole)}
          hasPassword={overview.mfaState.hasPassword}
          turnOffBlockedReason={blocked.turnOffTwoFactor ? t('security.keepAuthenticator') : null}
        />
        {showsConnectedAccounts && (
          <ConnectedAccountsCard
            message={message}
            providers={signInProviders}
            connected={links}
            disconnectBlocked={blocked.disconnect}
            disconnectBlockedReason={t('security.keepMfaProvider', { providers: giving })}
            connectBlocked={blocked.connectProvider}
            confirmBlocked={blocked.confirm}
            connectBlockedReason={providerMfaOnly}
          />
        )}
        <Card
          id="password"
          title={t('security.password.title')}
          description={
            overview.mfaState.hasPassword
              ? t('security.password.descriptionChange')
              : t('security.password.descriptionSet')
          }
        >
          <PasswordForm
            hasPassword={overview.mfaState.hasPassword}
            blockedReason={blocked.setPassword ? providerMfaOnly : null}
          />
        </Card>
        <SessionsCard sessions={sessions} table={devicesTable} currentSessionId={actor.sessionId} />
        <DeactivateCard
          hasPassword={overview.mfaState.hasPassword}
          blockedReason={soleAdmin ? serviceErrorMessage(soleAdmin, locale) : null}
        />
      </RecentConfirmationProvider>
    </>
  );
}

/**
 * The Security page of the account. Its cards' text comes with it
 * (`account`, and `auth` for the messages of refused sign-in changes).
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function SecurityPage({ searchParams }: PageProps<'/account/security'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <ClientMessages namespaces={['account', 'auth']}>
        <Security searchParams={searchParams} />
      </ClientMessages>
    </Suspense>
  );
}
