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
import { getTranslations } from 'next-intl/server';
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
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import { type OAuthProvider, providerNames } from '@/lib/sign-in/oauth-providers';
import { availableProviders, signInProviders } from '@/lib/sign-in/providers';
import type { SearchParams } from '@/lib/tables/search-params';
import { createPageUrl, parseTableState } from '@/lib/tables/table-state';
import { DEVICES_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { listConnectedProviders } from '@/server/auth/accounts';
import { getSecurityOverview } from '@/server/auth/security';
import { getActor } from '@/server/authz';
import { describeSoleAdmin, listUserSessions, soleAdminOf } from '@/server/people/user-admin';

import accountMessage from '../account-messages';
import ConnectedAccountsCard from './connected-accounts-card';
import DeactivateCard from './deactivate-card';
import PasskeysCard from './passkeys-card';
import PasswordForm from './password-form';
import SessionsCard from './sessions-card';
import TwoFactorCard from './two-factor-card';

/**
 * Page metadata.
 */
export const metadata: Metadata = {
  title: 'Security',
};

/** Shown where removing the last passkey would break a role's MFA requirement. */
const KEEP_LAST_PASSKEY =
  "Your role requires MFA, so keep this passkey until you've added another passkey or an authenticator app.";

/** Shown where turning off the only authenticator app would break a role's MFA requirement. */
const KEEP_AUTHENTICATOR =
  'Your role requires MFA, so your authenticator app stays on. To move it to a new phone, add a passkey first, then turn this off and set it up again.';

/**
 * Shown where disconnecting the account that gives a role its MFA is refused.
 *
 * @param providers - The providers whose accounts give it (e.g. GitHub).
 * @returns The reason.
 */
const keepMfaProvider = (providers: readonly OAuthProvider[]) =>
  `Your role requires MFA, and your ${providerNames(providers)} account with two-factor authentication gives you it. Add a passkey or an authenticator app before disconnecting it.`;

/**
 * Shown where a password or another connected account would stop provider
 * MFA counting as the MFA a role requires.
 *
 * @param providers - The providers whose accounts give it (e.g. GitHub).
 * @returns The reason.
 */
const providerMfaOnly = (providers: readonly OAuthProvider[]) =>
  `Your role requires MFA, and ${providerNames(providers)} with two-factor authentication only counts while you have no password and every connected account has it. Add a passkey or an authenticator app first.`;

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
  const params = await searchParams;
  const devicesRequested = parseTableState(DEVICES_TABLE, params);
  const [overview, connected, sessions, lastAdminOf] = await Promise.all([
    getSecurityOverview(appContext.db, actor),
    listConnectedProviders(appContext.db, actor.id),
    listUserSessions(appContext.db, actor.id, actor.mfaRole, devicesRequested),
    // Only shown: deactivating checks again, with locks, in its own transaction.
    soleAdminOf(appContext.db, actor.id, { lock: false }),
  ]);
  // Built from the table's own state only, so a sort doesn't bring back `?connected=…`.
  const url = createPageUrl('/account/security', {}, await getTranslations('tables'));
  const devicesTable = url.table(DEVICES_TABLE, {
    ...devicesRequested,
    page: sessions.page,
  });
  const message = accountMessage(params);
  // The same check that sent them here (`getActor`).
  const mustSetUp = mustSetUpMfa(actor);
  const setup = {
    authenticator: overview.authenticatorSetUp,
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
  const giving = mfaGivingProviders(overview.mfaState, availableProviders);

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
          Your role requires MFA. Add a passkey or set up an authenticator app to continue using
          Adiutor.
          {overview.twoFactorEnabled && ' Email codes aren’t enough for your role.'}
        </Alert>
      )}
      {!actor.mfaEnabled && !actor.mfaRequired && (
        <Alert tone="info">
          Recommended: add a passkey or turn on two-step verification, so a stolen password
          isn&apos;t enough to get into your account.
        </Alert>
      )}
      <RecentConfirmationProvider
        required={actor.canConfirmSessions}
        // The page with its devices table; each control adds its card's anchor.
        returnTo={url.current()}
        {...confirmationWindow(actor.mfaConfirmedUntil)}
      >
        <PasskeysCard
          passkeys={overview.passkeys}
          removeLastBlockedReason={blocked.lastPasskey ? KEEP_LAST_PASSKEY : null}
        />
        <TwoFactorCard
          email={actor.email}
          enabled={overview.twoFactorEnabled}
          authenticatorSetUp={overview.authenticatorSetUp}
          emailCodes={emailCodeStatus(setup, actor.mfaRole)}
          hasPassword={overview.hasPassword}
          turnOffBlockedReason={blocked.turnOffTwoFactor ? KEEP_AUTHENTICATOR : null}
        />
        {showsConnectedAccounts && (
          <ConnectedAccountsCard
            message={message}
            providers={signInProviders}
            connected={links}
            disconnectBlocked={blocked.disconnect}
            disconnectBlockedReason={keepMfaProvider(giving)}
            connectBlocked={blocked.connectProvider}
            confirmBlocked={blocked.confirm}
            connectBlockedReason={providerMfaOnly(giving)}
          />
        )}
        <Card
          id="password"
          title="Password"
          description={
            overview.hasPassword
              ? 'Changing it signs you out on your other devices.'
              : "You don't have a password yet; you sign in with an email link or another provider. Set one to also sign in with your email and password."
          }
        >
          <PasswordForm
            hasPassword={overview.hasPassword}
            blockedReason={blocked.setPassword ? providerMfaOnly(giving) : null}
          />
        </Card>
        <SessionsCard sessions={sessions} table={devicesTable} currentSessionId={actor.sessionId} />
        <DeactivateCard
          hasPassword={overview.hasPassword}
          blockedReason={describeSoleAdmin("You're", lastAdminOf)}
        />
      </RecentConfirmationProvider>
    </>
  );
}

/**
 * The Security page of the account.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function SecurityPage({ searchParams }: PageProps<'/account/security'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <Security searchParams={searchParams} />
    </Suspense>
  );
}
