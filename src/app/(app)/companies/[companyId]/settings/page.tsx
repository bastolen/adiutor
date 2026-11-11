/**
 * @file Company settings, served at `/companies/[companyId]/settings`:
 * rename, and deactivate or reactivate (staff only).
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Card from '@/components/ui/card';
import RowAction from '@/components/ui/row-action';
import { PageSkeleton } from '@/components/ui/skeleton';
import ToastOnArrival from '@/components/ui/toast-on-arrival';
import ClientMessages from '@/lib/i18n/client-messages';
import { type SearchParams, searchParam } from '@/lib/search-params';
import { requireCompanyAccess } from '@/server/authz';
import { companyPermissionMetadata } from '@/server/page-metadata';

import { setActiveAction } from './actions';
import CompanyForm from './company-form';

/**
 * Page metadata: "Settings · <company> · Adiutor" (the company layout adds the
 * rest) for those who may see the page (`company:update`), and the 404 page's title
 * for everyone else, who get the 404 page.
 */
// i18n-check t('companies.settings.title')
export const generateMetadata = companyPermissionMetadata(
  'company:update',
  'companies.settings.title',
);

/**
 * Shows the settings the user may change. Its text comes from the
 * `companies` namespace (the form, a client component, gets it through
 * `ClientMessages`).
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
  const [{ companyId }, query, t] = await Promise.all([
    params,
    searchParams,
    getTranslations('companies.settings'),
  ]);
  const { company, permissions } = await requireCompanyAccess(companyId, 'company:update');
  const deactivated = company.deactivatedAt !== null;
  // Set by the redirect after a new URL name; not part of any link on this page.
  const saved = searchParam(query.saved) === '1';

  return (
    <>
      {saved && <ToastOnArrival message={t('saved')} />}
      <Card title={t('details.title')} description={t('details.description')}>
        <ClientMessages namespaces={['companies.settings.form']}>
          <CompanyForm companyId={company.id} name={company.name} slug={company.slug} />
        </ClientMessages>
      </Card>
      {permissions.has('company:deactivate') && (
        <Card
          title={t('danger.title')}
          tone={deactivated ? 'default' : 'danger'}
          description={
            deactivated ? t('danger.deactivatedDescription') : t('danger.activeDescription')
          }
        >
          <div>
            <RowAction
              action={setActiveAction}
              fields={{ companyId: company.id, active: String(deactivated) }}
              label={deactivated ? t('danger.reactivate.label') : t('danger.deactivate.label')}
              variant={deactivated ? 'secondary' : 'danger'}
              confirm={
                deactivated
                  ? {
                      title: t('danger.reactivate.title', { company: company.name }),
                      description: t('danger.reactivate.description'),
                      confirmLabel: t('danger.reactivate.confirm'),
                    }
                  : {
                      title: t('danger.deactivate.title', { company: company.name }),
                      description: t('danger.activeDescription'),
                      confirmLabel: t('danger.deactivate.confirm'),
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
