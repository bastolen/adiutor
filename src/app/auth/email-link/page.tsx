/**
 * @file The page sign-in emails link to, served at `/auth/email-link`. It
 * names the account the link signs in to (looked up without using the link,
 * `getEmailLinkPreview`), so a link someone else sent for their own account
 * can't sign you into it unnoticed. It asks for a click before using the
 * link, so mail scanners that open links to check them don't use it up or
 * get a session (see `src/lib/sign-in/email-link.ts`). Its Continue is a
 * form `POST`, which only this page makes (decision 0041).
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { FormSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import secretLinkMetadata from '@/lib/secret-link-metadata';

import EmailLinkStep from './email-link-step';

/**
 * Page metadata: "Continue signing in", in the request's language. The page
 * is only reached through a personal link, so it's kept out of search
 * engines, and its address (with the link's token) isn't sent along to other
 * pages. Like the request link's page, it sends the site's origin, never
 * more (`strict-origin`): its Continue is a form `POST`, which the guards
 * and Better Auth check against the site's address (`Origin`), and with no
 * referrer at all the browser would send `Origin: null`.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { ...secretLinkMetadata, referrer: 'strict-origin', title: t('emailLink.title') };
}

/**
 * The email-link page. It reads the link from the URL, so it renders at
 * request time behind a Suspense boundary, with its form's text (`auth`).
 *
 * @returns The page.
 */
export default function EmailLinkPage({ searchParams }: PageProps<'/auth/email-link'>) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ClientMessages namespaces={['auth']}>
        <EmailLinkStep searchParams={searchParams} />
      </ClientMessages>
    </Suspense>
  );
}
