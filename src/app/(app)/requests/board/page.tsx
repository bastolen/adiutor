/**
 * @file The board of requests, served at `/requests/board`: the requests the
 * viewer may see across companies, as the list (`/requests`) shows them, in a
 * lane per status, with the list's search, filters and sort. Each card's Move
 * menu moves it to another lane, as far as the viewer's role allows; a
 * Watcher, Finance or anyone in a deactivated company only reads. Everyone
 * signed in may open it.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import WidePage from '@/components/layout/wide-page';
import { BoardSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import type { SearchParams } from '@/lib/search-params';
import { getActor } from '@/server/authz';

import RequestBoard from '../../_requests/request-board';

/**
 * Page metadata: "Request board · Adiutor", for everyone signed in.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('requests.board');
  return { title: t('title') };
}

/**
 * Reads the viewer and shows their board, with the messages its browser part
 * needs: the board's own, and the request page's controls, whose words the
 * Done and Cancel questions reuse.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: the search, the filters, the sort and the cards
 *   per lane (see `RequestBoard`).
 * @returns The page content.
 */
async function Board({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getActor();
  const params = await searchParams;
  return (
    <ClientMessages namespaces={['requests.board', 'requests.controls']}>
      <RequestBoard searchParams={params} actor={actor} />
    </ClientMessages>
  );
}

/**
 * The board page, as wide as a request's page on a wide screen (`WidePage`).
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function RequestBoardPage({ searchParams }: PageProps<'/requests/board'>) {
  // Lanes side by side: on a wide screen the board gets the room a request's page gets, so
  // more lanes show before the row scrolls sideways.
  return (
    <WidePage>
      <Suspense fallback={<BoardSkeleton />}>
        <Board searchParams={searchParams} />
      </Suspense>
    </WidePage>
  );
}
