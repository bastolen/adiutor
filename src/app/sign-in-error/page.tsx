/**
 * @file The sign-in error page, served at `/sign-in-error` (public): where
 * Better Auth sends people when signing in fails with nowhere else to go
 * (`onAPIError` in `src/lib/auth.ts`). Built like the 404 page: a large,
 * quiet icon, what happened, a reference for an admin, and the way out.
 */
import { ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import CenteredLayout from '@/components/layout/centered-layout';
import BackButton from '@/components/ui/back-button';
import { Skeleton } from '@/components/ui/skeleton';

import { SignInAgainButton, SignInErrorHeading } from './shell-text';
import SignInErrorDetails from './sign-in-error-details';

/**
 * Page metadata: "Sign-in problem", in the request's language. The page is
 * only reached through a failed sign-in, so it's kept out of search engines.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return {
    title: t('signInError.title'),
    robots: { index: false, follow: false },
  };
}

/**
 * Placeholder while the error is recorded: the message and the reference box.
 */
function DetailsSkeleton() {
  return (
    <div aria-busy="true" className="flex w-full flex-col items-center gap-4">
      <Skeleton className="h-5 w-72 max-w-full" />
      <Skeleton className="h-40 w-full max-w-sm rounded-xl" />
    </div>
  );
}

/**
 * The sign-in error page. The heading and the buttons are in its static
 * shell (`shell-text.tsx`); what went wrong and the reference come per
 * request.
 */
export default function SignInErrorPage({ searchParams }: PageProps<'/sign-in-error'>) {
  return (
    <CenteredLayout>
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <ShieldAlert
            aria-hidden="true"
            strokeWidth={1.5}
            className="size-20 text-muted-foreground"
          />
          <SignInErrorHeading />
          <Suspense fallback={<DetailsSkeleton />}>
            <SignInErrorDetails searchParams={searchParams} />
          </Suspense>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <SignInAgainButton />
          <BackButton className="w-full sm:w-auto" />
        </div>
      </div>
    </CenteredLayout>
  );
}
