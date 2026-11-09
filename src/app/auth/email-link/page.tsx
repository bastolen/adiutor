/**
 * @file The page sign-in emails link to, served at `/auth/email-link`. It
 * names the account the link signs in to (looked up without using the link,
 * `getEmailLinkPreview`), so a link someone else sent for their own account
 * can't sign you into it unnoticed. It asks for a click before using the
 * link, so mail scanners that open links to check them don't use it up or
 * get a session (see `src/lib/sign-in/email-link.ts`).
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FormSkeleton } from '@/components/ui/skeleton';
import secretLinkMetadata from '@/lib/secret-link-metadata';

import EmailLinkStep from './email-link-step';

/**
 * Page metadata. The page is only reached through a personal link, so it's
 * kept out of search engines, and its address (with the link's token) isn't
 * sent along to other pages.
 */
export const metadata: Metadata = { ...secretLinkMetadata, title: 'Continue signing in' };

/**
 * The email-link page. It reads the link from the URL, so it renders at
 * request time behind a Suspense boundary.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - The query string, with the link's token.
 * @returns The page.
 */
export default function EmailLinkPage({ searchParams }: PageProps<'/auth/email-link'>) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <EmailLinkStep searchParams={searchParams} />
    </Suspense>
  );
}
