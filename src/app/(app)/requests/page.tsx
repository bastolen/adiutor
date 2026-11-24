/**
 * @file The requests list, served at `/requests`: every request the viewer
 * may see, across companies. For the staff that's every company's; for
 * everyone else, the requests of the companies they're in. Everyone signed
 * in may open it; someone in no company finds it empty. A toggle shows the
 * same requests as a board (`/requests/board`). On a wide screen it's as wide
 * as the board (`WidePage`), so its table has room for the company in a
 * column of its own.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import WidePage from '@/components/layout/wide-page';
import { PageSkeleton } from '@/components/ui/skeleton';
import type { SearchParams } from '@/lib/search-params';
import { getActor } from '@/server/authz';

import RequestList from '../_requests/request-list';
import RequestsHeader from '../_requests/requests-header';

/**
 * Page metadata: "Requests · Adiutor", for everyone signed in.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('requests.list');
  return { title: t('title') };
}

/**
 * Shows the list under its header, which has a button to raise a request for
 * those who may raise one somewhere, and the List | Board toggle. The list
 * loads the companies, settings and filters the header needs and hands them
 * to it.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: the search, the filters, and the table's sort and
 *   page (see `RequestList`).
 * @returns The page content.
 */
async function Requests({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getActor();
  const params = await searchParams;

  return (
    <RequestList
      path="/requests"
      searchParams={params}
      actor={actor}
      renderHeader={(loaded) => <RequestsHeader actor={actor} view="list" {...loaded} />}
    />
  );
}

/**
 * The requests page, as wide as the board on a wide screen (`WidePage`).
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function RequestsPage({ searchParams }: PageProps<'/requests'>) {
  return (
    <WidePage>
      <Suspense fallback={<PageSkeleton />}>
        <Requests searchParams={searchParams} />
      </Suspense>
    </WidePage>
  );
}
