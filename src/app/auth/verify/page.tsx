/**
 * @file The step-up page, served at `/auth/verify`: anyone with MFA on their
 * account who signed in without a second step that counts (an email link, a
 * provider that can't prove MFA or whose account has no 2FA, a password on a
 * passkey-only account, or for roles that require MFA an email code) confirms
 * their session here before they can continue. `getActor()` sends them here. So does the Security page
 * before a change to how they sign in, which needs a confirmation from the
 * last 15 minutes (`needsRecentConfirmation`), also for someone whose second
 * step doesn't count as MFA (a provider account with 2FA next to a password),
 * and an Admin's MFA reset on a user's detail page (`resetMfaAction`), which
 * needs the same confirmation.
 *
 * The Security page and the MFA reset send them in change mode (`for=change`,
 * see `confirmChangeUrl`), as does a session that's confirmed already
 * (it can only be here for a change): then only the methods that open the
 * window for changing sign-in methods are offered (`windowOpeningMethods`),
 * so GitHub isn't offered next to a passkey or an authenticator app, where it
 * would confirm the session but send the user straight back here. An
 * account whose only strong step is GitHub still gets GitHub, which opens the
 * window there.
 *
 * Once confirmed, they go back to `callbackURL`: the page, its tables' sort
 * and page, and the anchor of the card where they clicked (`getSafeRedirectPath`
 * keeps an anchor only when it names a section).
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { FormSkeleton } from '@/components/ui/skeleton';
import { needsRecentConfirmation } from '@/lib/authz/mfa';
import ClientMessages from '@/lib/i18n/client-messages';
import { DEFAULT_SIGNED_IN_PATH, getSafeRedirectPath } from '@/lib/redirect';
import { type SearchParams, searchParam } from '@/lib/search-params';
import { reverifyErrorText } from '@/lib/sign-in/auth-error-messages';
import appContext from '@/server/app-context';
import { getStepUpMethods } from '@/server/auth/security';
import { getOptionalActor } from '@/server/authz';

import StepUpForm from './step-up-form';

/**
 * Page metadata: "Confirm it’s you", in the request's language.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('stepUp.title') };
}

/**
 * Loads the user's methods, or sends them on when there's nothing to
 * confirm.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters (`callbackURL`, `for=change`
 *   from the Security page, and after "Confirm with GitHub" didn't sign in:
 *   `error` and the `provider` it named).
 * @returns The form.
 */
async function StepUp({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const callbackURL = getSafeRedirectPath(searchParam(params.callbackURL));
  const actor = await getOptionalActor();
  if (!actor) {
    redirect(`/auth?callbackURL=${encodeURIComponent(callbackURL)}`);
  }
  // Signed in as someone: there's nothing to confirm, and nothing changes from their view.
  if (actor.signedInAs) {
    redirect(DEFAULT_SIGNED_IN_PATH);
  }
  // Confirmed recently enough for anything, or no second step that can be used here.
  if (!needsRecentConfirmation(actor)) {
    redirect(callbackURL);
  }

  // A confirmed session is only here for a change to how the user signs in.
  const forChange = searchParam(params.for) === 'change' || actor.sessionMfaVerified;
  // Only the providers configured here (`availableProviders`) are offered, and for a change only
  // the methods that open its window.
  const methods = await getStepUpMethods(appContext, actor.id, actor.mfaRole, { forChange });
  // A different account than the user's own confirmed one names the provider, and never says
  // whether an address has an account (`reverifyErrorText`).
  const initialError = reverifyErrorText(
    await getTranslations('auth'),
    searchParam(params.error),
    searchParam(params.provider),
  );
  return (
    <StepUpForm
      // The page stays alive between visits (React's <Activity>); a form for other methods starts
      // over (e.g. an authenticator app set up since the last visit).
      key={[
        ...(['authenticator', 'email', 'passkey'] as const).filter((method) => methods[method]),
        ...methods.providers,
      ].join()}
      methods={methods}
      roleRequiresMfa={actor.mfaRequired}
      accountHasMfa={actor.mfaEnabled}
      confirmedBefore={actor.sessionMfaVerified}
      callbackURL={callbackURL}
      initialError={initialError}
    />
  );
}

/**
 * The step-up page. The form's text comes with it (`auth`).
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function VerifyPage({ searchParams }: PageProps<'/auth/verify'>) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ClientMessages namespaces={['auth']}>
        <StepUp searchParams={searchParams} />
      </ClientMessages>
    </Suspense>
  );
}
