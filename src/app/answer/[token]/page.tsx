/**
 * @file The page an email's Approve and Deny links end on, served at
 * `/answer/<token>` (public, decision 0033): what the link did, a button
 * that answers when the link was opened without a person's click (a mail
 * scanner), or why it can't answer any more.
 */
import { Suspense } from 'react';

import { FormSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';

import AnswerLinkStep from './answer-link-step';

/**
 * The answer link's page. It reads the link from its address, so it renders
 * at request time behind a Suspense boundary, with its form's text
 * (`requests.answerLink`).
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters: the link's token.
 * @param props.searchParams - The query string: the answer a button in the email stood for.
 * @returns The page.
 */
export default function AnswerLinkPage({ params, searchParams }: PageProps<'/answer/[token]'>) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ClientMessages namespaces={['requests.answerLink']}>
        <AnswerLinkStep params={params} searchParams={searchParams} />
      </ClientMessages>
    </Suspense>
  );
}
