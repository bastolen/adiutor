/**
 * @file The 404 page, for pages that don't exist and pages the user may not
 * see (both look the same, so nothing about other companies is revealed).
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import CenteredLayout from '@/components/layout/centered-layout';
import BackButton from '@/components/ui/back-button';
import Button from '@/components/ui/button';
import { NOT_FOUND_TITLE } from '@/lib/not-found-metadata';

/**
 * Page metadata: the title pages the user may not see give them too.
 */
export const metadata: Metadata = {
  title: NOT_FOUND_TITLE,
};

/**
 * A large, quiet "404", what happened, and the way out: the dashboard (which
 * sends signed-out visitors to sign in) and, when there's a previous page in
 * this tab, back to it.
 *
 * @returns The 404 page.
 */
export default function NotFound() {
  return (
    <CenteredLayout>
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <p className="text-8xl leading-none font-semibold tracking-tighter text-muted-foreground tabular-nums">
            404
          </p>
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">Page not found</h1>
          <p className="max-w-sm text-base text-balance text-muted-foreground">
            This page doesn&apos;t exist, or you don&apos;t have access to it.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button asChild className="w-full sm:w-auto">
            <Link href="/dashboard">Go to your dashboard</Link>
          </Button>
          <BackButton className="w-full sm:w-auto" />
        </div>
      </div>
    </CenteredLayout>
  );
}
