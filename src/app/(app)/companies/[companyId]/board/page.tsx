/**
 * @file A company's board of requests, served at
 * `/companies/[companyId]/board`: the company's requests, as its list (the
 * company's first page) shows them, in a lane per status, with the list's
 * search, filters and sort, under the company's header with its Requests
 * tab current. Each card's Move menu moves it to another lane, as far as the
 * viewer's role allows; a deactivated company's requests can only be read.
 * Everyone who may see the company's requests may open it: its people, and
 * the staff. The company's layout makes it as wide as the board across
 * companies on a wide screen, header and tabs included.
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Alert from '@/components/ui/alert';
import { BoardSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import type { SearchParams } from '@/lib/search-params';
import { requireCompanyAccess } from '@/server/authz';
import { companyPermissionMetadata } from '@/server/page-metadata';

import RequestBoard from '../../../_requests/request-board';
import { companyViewPaths } from '../../../_requests/request-view-toggle';

/**
 * Page metadata: "Request board · Adiutor Tests · Adiutor" for those who may
 * see the company's requests (`requests:view`), and the 404 page's title for
 * everyone else, who get the 404 page.
 */
// i18n-check t('requests.board.title')
export const generateMetadata = companyPermissionMetadata('requests:view', 'requests.board.title');

/**
 * Loads the company and shows its board, with the messages its browser part
 * needs: the board's own, and the request page's controls, whose words the
 * Done and Cancel questions reuse. A deactivated company's board can only be
 * read, which the page says; only the staff get that far.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters: the search, the filters, the sort and the cards
 *   per lane (see `RequestBoard`).
 * @returns The page content.
 */
async function CompanyBoard({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ companyId }, query] = await Promise.all([params, searchParams]);
  const t = await getTranslations('companies.requests');
  const { company, actor } = await requireCompanyAccess(companyId, 'requests:view');

  return (
    <>
      {company.deactivatedAt && <Alert tone="info">{t('deactivated')}</Alert>}
      <ClientMessages namespaces={['requests.board', 'requests.controls']}>
        <RequestBoard
          searchParams={query}
          actor={actor}
          company={company.slug}
          // Its links use the company's URL name, also when the page was opened by its ID.
          paths={companyViewPaths(company.slug)}
        />
      </ClientMessages>
    </>
  );
}

/**
 * The company's board page.
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function CompanyBoardPage({
  params,
  searchParams,
}: PageProps<'/companies/[companyId]/board'>) {
  return (
    <Suspense fallback={<BoardSkeleton header={false} />}>
      <CompanyBoard params={params} searchParams={searchParams} />
    </Suspense>
  );
}
