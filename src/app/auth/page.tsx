/**
 * @file Sign-in page, served at `/auth`. Visitors who are signed in already
 * go on to the page they asked for: switching accounts means signing out
 * first.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { FormSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import { signedInPath } from '@/lib/redirect';
import { type SearchParams, searchParam } from '@/lib/search-params';
import { signInProviders } from '@/lib/sign-in/providers';
import appContext from '@/server/app-context';
import { getOptionalActor } from '@/server/authz';
import { isWebSetupOpen } from '@/server/setup';

import SignInForm from './sign-in-form';

/**
 * Page metadata: "Sign in", in the request's language.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signIn.title') };
}

/**
 * Renders the sign-in form with the providers configured on the server.
 * Waits for the request so provider settings come from the running server's
 * environment, not the build. On a fresh install (nothing set up, no
 * accounts), sends the visitor to `/setup` instead.
 *
 * Someone signed in already goes on to the requested page (`callbackURL`,
 * when it's safe) or the dashboard; `getActor()` there sends users who must
 * confirm their session or set up MFA on. A deactivated account counts as
 * signed out (`getOptionalActor`), so it gets the form. This isn't done in
 * the proxy, which only sees that a cookie exists: a stale one would bounce
 * between this page and the next.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters (`callbackURL`; the form reads
 *   the others in the browser).
 */
async function SignInOptions({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  if (await isWebSetupOpen(appContext.db)) {
    redirect('/setup');
  }
  if (await getOptionalActor()) {
    redirect(signedInPath(searchParam((await searchParams).callbackURL)));
  }
  return <SignInForm providers={signInProviders} />;
}

/**
 * The sign-in page. The form's text comes with it (`auth`).
 */
export default function SignInPage({ searchParams }: PageProps<'/auth'>) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ClientMessages namespaces={['auth']}>
        <SignInOptions searchParams={searchParams} />
      </ClientMessages>
    </Suspense>
  );
}
