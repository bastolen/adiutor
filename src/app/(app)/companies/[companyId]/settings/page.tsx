/**
 * @file Company settings, served at `/companies/[companyId]/settings`:
 * rename, and deactivate or reactivate (staff only).
 */
import { Suspense } from 'react';

import Card from '@/components/ui/card';
import RowAction from '@/components/ui/row-action';
import { PageSkeleton } from '@/components/ui/skeleton';
import ToastOnArrival from '@/components/ui/toast-on-arrival';
import { type SearchParams, searchParam } from '@/lib/tables/search-params';
import { requireCompanyAccess } from '@/server/authz';
import { companyPermissionMetadata } from '@/server/page-metadata';

import { setActiveAction } from './actions';
import CompanyForm from './company-form';

/**
 * Page metadata: "Settings · <company> · Adiutor" (the company layout adds the
 * rest) for those who may see the page (`company:update`), and the 404 page's title
 * for everyone else, who get the 404 page.
 */
export const generateMetadata = companyPermissionMetadata('company:update', { title: 'Settings' });

/**
 * Shows the settings the user may change.
 *
 * @param props - Component props.
 * @param props.params - Route parameters: the company's ID or URL name.
 * @param props.searchParams - Query parameters: `saved=1` after a new URL name moved the page here.
 * @returns The page content.
 */
async function Settings({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ companyId }, query] = await Promise.all([params, searchParams]);
  const { company, permissions } = await requireCompanyAccess(companyId, 'company:update');
  const deactivated = company.deactivatedAt !== null;
  // Set by the redirect after a new URL name; not part of any link on this page.
  const saved = searchParam(query.saved) === '1';

  return (
    <>
      {saved && <ToastOnArrival message="Saved." />}
      <Card title="Details" description="The name shown in Adiutor, and the address of its pages.">
        <CompanyForm companyId={company.id} name={company.name} slug={company.slug} />
      </Card>
      {permissions.has('company:deactivate') && (
        <Card
          title="Danger zone"
          tone={deactivated ? 'default' : 'danger'}
          description={
            deactivated
              ? 'This company is deactivated. Reactivating gives its people access again; nothing was deleted.'
              : "Its people lose access and can't raise requests until it's reactivated. Nothing is deleted."
          }
        >
          <div>
            <RowAction
              action={setActiveAction}
              fields={{ companyId: company.id, active: String(deactivated) }}
              label={deactivated ? 'Reactivate company' : 'Deactivate company'}
              variant={deactivated ? 'secondary' : 'danger'}
              confirm={
                deactivated
                  ? {
                      title: `Reactivate ${company.name}?`,
                      description: 'Its people get access again.',
                      confirmLabel: 'Reactivate',
                    }
                  : {
                      title: `Deactivate ${company.name}?`,
                      description:
                        "Its people lose access and can't raise requests until it's reactivated. Nothing is deleted.",
                      confirmLabel: 'Deactivate',
                    }
              }
            />
          </div>
        </Card>
      )}
    </>
  );
}

/**
 * The company settings page.
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function SettingsPage({
  params,
  searchParams,
}: PageProps<'/companies/[companyId]/settings'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <Settings params={params} searchParams={searchParams} />
    </Suspense>
  );
}
