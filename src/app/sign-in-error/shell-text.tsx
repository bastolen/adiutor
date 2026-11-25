/**
 * @file The text of the sign-in error page that's in its static shell,
 * outside its `<Suspense>`: the heading and the way back to sign in. Client
 * components, so their text comes from the root provider
 * (`common.signInError`) and Partial Prefetching can prefetch the shell
 * without reading the request (docs/i18n.md).
 */
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import Button from '@/components/ui/button';

/**
 * The page's `h1`: "Signing in didn't work".
 */
export function SignInErrorHeading() {
  const t = useTranslations('common');
  return (
    <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
      {t('signInError.heading')}
    </h1>
  );
}

/**
 * The page's main way out: "Sign in again", to the sign-in page.
 *
 * @returns The link, styled as the primary button.
 */
export function SignInAgainButton() {
  const t = useTranslations('common');
  return (
    <Button asChild className="w-full sm:w-auto">
      <Link href="/auth">{t('signInError.signInAgain')}</Link>
    </Button>
  );
}
