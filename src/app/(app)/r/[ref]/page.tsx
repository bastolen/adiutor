/**
 * @file A short link to a request: `/r/142`, or `/r/AD-142` with the staff's
 * current prefix in any case, redirects to the request's page
 * (`/requests/142`). Anything else gives the 404 page. Like every page of the
 * app, it's for people who are signed in. The redirect goes to the number
 * whether or not the request exists or the reader may see it: the request's
 * page decides that, so the short link reveals nothing.
 */
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';

import { PageSkeleton } from '@/components/ui/skeleton';
import { requestPath } from '@/lib/requests';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { findRequestNumber } from '@/server/requests';

/**
 * Sends the short link on to its request's page, or ends on the 404 page.
 *
 * @param props - Component props.
 * @param props.params - Route parameters: the request's number, with or without the prefix.
 * @returns Nothing: it always redirects or ends on the 404 page.
 */
async function ShortLink({ params }: { params: Promise<{ ref: string }> }): Promise<null> {
  await getActor();
  const number = await findRequestNumber(appContext, (await params).ref);
  if (number === null) {
    notFound();
  }
  redirect(requestPath(number));
}

/**
 * The short link's page, which only redirects.
 *
 * @param props - Page props.
 * @param props.params - Route parameters: the request's number, with or without the prefix.
 * @returns The page content, while it redirects.
 */
export default function RequestShortLinkPage({ params }: PageProps<'/r/[ref]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ShortLink params={params} />
    </Suspense>
  );
}
