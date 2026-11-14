/**
 * @file The requests list, served at `/requests`: every request the viewer
 * may see, across companies. For the staff that's every company's; for
 * everyone else, the requests of the companies they're in. Everyone signed
 * in may open it; someone in no company finds it empty.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import PageHeader from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import type { SearchParams } from '@/lib/search-params';
import appContext from '@/server/app-context';
import { getActor, getStaffPermissionsInCompanies } from '@/server/authz';
import { getRequestSettings, listRequestCompanies } from '@/server/requests';

import RequestList, { NewRequestButton } from '../_requests/request-list';

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
 * Loads and shows the list, with a button to raise a request for those who
 * may raise one somewhere.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: the search, the filters, and the table's sort and
 *   page (see `RequestList`).
 * @returns The page content.
 */
async function Requests({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const t = await getTranslations('requests.list');
  const actor = await getActor();
  const [params, companies, settings] = await Promise.all([
    searchParams,
    listRequestCompanies(appContext, actor),
    getRequestSettings(appContext),
  ]);
  const staff = getStaffPermissionsInCompanies(actor).has('requests:view');

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description', {
          audience: staff ? 'staff' : 'company',
          staff: settings.staffName,
        })}
        actions={
          companies.some(({ canRaise }) => canRaise) && <NewRequestButton label={t('new')} />
        }
      />
      <RequestList path="/requests" searchParams={params} actor={actor} />
    </>
  );
}

/**
 * The requests page.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function RequestsPage({ searchParams }: PageProps<'/requests'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Requests searchParams={searchParams} />
    </Suspense>
  );
}
