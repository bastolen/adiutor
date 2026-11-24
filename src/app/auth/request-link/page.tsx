/**
 * @file The confirmation page of the link in an email about a request
 * (decision 0036), served at `/auth/request-link`. The link signs a person's
 * click in straight away (`src/lib/sign-in/request-link.ts`); it comes here
 * instead when it can't: a mail scanner or a browser that doesn't say a
 * person clicked, someone else signed in in this browser, or a link that no
 * longer works. The page names the account the link signs in to (looked up
 * without using it, `getRequestLinkView`) and asks for a click, or, with
 * nobody signed in in this browser, continues by itself once it has loaded
 * (decision 0038).
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { FormSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import secretLinkMetadata from '@/lib/secret-link-metadata';

import RequestLinkStep from './request-link-step';

/**
 * Page metadata: "Open the request", in the request's language. The page is
 * only reached through a personal link, so it's kept out of search engines,
 * and its address (with the link's token) isn't sent along to other pages.
 * Unlike other such pages it sends the site's origin, never more
 * (`strict-origin`): its Continue is a form `POST`, which Better Auth checks
 * against the site's address (`Origin`), and with no referrer at all the
 * browser would send `Origin: null`.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { ...secretLinkMetadata, referrer: 'strict-origin', title: t('requestLink.title') };
}

/**
 * The request link's page. It reads the link from the URL, so it renders at
 * request time behind a Suspense boundary, with its form's text (`auth`).
 *
 * @returns The page.
 */
export default function RequestLinkPage({ searchParams }: PageProps<'/auth/request-link'>) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ClientMessages namespaces={['auth']}>
        <RequestLinkStep searchParams={searchParams} />
      </ClientMessages>
    </Suspense>
  );
}
