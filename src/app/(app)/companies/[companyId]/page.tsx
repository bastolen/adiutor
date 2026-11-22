/**
 * @file A company's requests, served at `/companies/[companyId]`: the
 * company's first page. The same list as `/requests`, for this company only,
 * for everyone who may see the company: its members, and the staff. A List |
 * Board toggle above it leads to the company's board (`board/page.tsx`).
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Alert from '@/components/ui/alert';
import { PageSkeleton } from '@/components/ui/skeleton';
import type { SearchParams } from '@/lib/search-params';
import { requireCompanyAccess } from '@/server/authz';
import { companyPermissionMetadata } from '@/server/page-metadata';

import RequestList from '../../_requests/request-list';
import RequestViewToggle, { companyViewPaths } from '../../_requests/request-view-toggle';
import AccessNotice from '../../access-notice';

/**
 * Page metadata: "Requests · Adiutor Tests · Adiutor" for those who may see
 * the company's requests (`requests:view`), and the 404 page's title for
 * everyone else, who get the 404 page. The title names the company itself:
 * the layout's title template doesn't reach the page in its own route
 * segment (see `companyPermissionMetadata`).
 */
// i18n-check t('companies.requests.title')
export const generateMetadata = companyPermissionMetadata(
  'requests:view',
  'companies.requests.title',
);

/**
 * Loads and shows the company's requests. A deactivated company's requests
 * can only be read, which the page says; only the staff get that far.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters: the search, the filters, and the table's sort and
 *   page (see `RequestList`).
 * @returns The page content.
 */
async function CompanyRequests({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ companyId }, query] = await Promise.all([params, searchParams]);
  const t = await getTranslations('companies.requests');
  const { company, actor } = await requireCompanyAccess(companyId, 'requests:view');
  const paths = companyViewPaths(company.slug);

  return (
    <>
      {/* After stepping down on the Members page, which only Admins see. */}
      <AccessNotice />
      {company.deactivatedAt && <Alert tone="info">{t('deactivated')}</Alert>}
      <RequestList
        // Its links use the company's URL name, also when the page was opened by its ID.
        path={paths.list}
        searchParams={query}
        actor={actor}
        company={company.slug}
        renderHeader={({ filters }) => (
          <RequestViewToggle view="list" filters={filters} paths={paths} />
        )}
      />
    </>
  );
}

/**
 * The company's requests page.
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function CompanyPage({ params, searchParams }: PageProps<'/companies/[companyId]'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <CompanyRequests params={params} searchParams={searchParams} />
    </Suspense>
  );
}
