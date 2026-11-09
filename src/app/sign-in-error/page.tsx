/**
 * @file The sign-in error page, served at `/sign-in-error` (public): where
 * Better Auth sends people when signing in fails with nowhere else to go
 * (`onAPIError` in `src/lib/auth.ts`). Built like the 404 page: a large,
 * quiet icon, what happened, a reference for an admin, and the way out.
 */
import { ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import CenteredLayout from '@/components/layout/centered-layout';
import BackButton from '@/components/ui/back-button';
import Button from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import SignInErrorDetails from './sign-in-error-details';

/**
 * Page metadata. The page is only reached through a failed sign-in, so it's
 * kept out of search engines.
 */
export const metadata: Metadata = {
  title: 'Sign-in problem',
  robots: { index: false, follow: false },
};

/**
 * Placeholder while the error is recorded: the message and the reference box.
 *
 * @returns The placeholder.
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
 * The sign-in error page.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters: Better Auth's `error` and `error_description`.
 * @returns The page.
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
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            Signing in didn&apos;t work
          </h1>
          <Suspense fallback={<DetailsSkeleton />}>
            <SignInErrorDetails searchParams={searchParams} />
          </Suspense>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button asChild className="w-full sm:w-auto">
            <Link href="/auth">Sign in again</Link>
          </Button>
          <BackButton className="w-full sm:w-auto" />
        </div>
      </div>
    </CenteredLayout>
  );
}
