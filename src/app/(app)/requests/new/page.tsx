/**
 * @file The page that raises a request, served at `/requests/new`. For
 * everyone who may raise one somewhere: a company's Admins and Clients in
 * their own companies, and the staff who work on requests in any active
 * company. Everyone else gets the 404 page.
 */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Card from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import { type SearchParams, searchParam } from '@/lib/search-params';
import type { Actor } from '@/server/actor';
import appContext from '@/server/app-context';
import { getActor, getStaffPermissionsInCompanies } from '@/server/authz';
import { checkedPageMetadata } from '@/server/page-metadata';
import { getRequestSettings, listRequestCompanies, listRequestTypes } from '@/server/requests';

import RaiseRequestForm from './raise-request-form';

/**
 * The companies someone may raise a request in.
 *
 * @param actor - The acting user.
 * @returns The companies; empty when they may raise none.
 */
async function raisableCompanies(actor: Actor) {
  const companies = await listRequestCompanies(appContext, actor);
  return companies.filter(({ canRaise }) => canRaise);
}

/**
 * Page metadata: "New request · Adiutor" for those who may raise a request
 * somewhere, and the 404 page's title for everyone else, who get the 404
 * page.
 */
// i18n-check t('requests.new.title')
export const generateMetadata = checkedPageMetadata('requests.new.title', async (actor) =>
  (await raisableCompanies(actor)).length > 0 ? {} : null,
);

/**
 * Loads and shows the form. The company in the address (`?company=`, from a
 * company's own list) is chosen already when it's one the viewer may raise a
 * request in.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: `company`, a company's URL name.
 * @returns The page content.
 */
async function NewRequest({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const t = await getTranslations('requests.new');
  const actor = await getActor();
  const [params, companies, settings, types] = await Promise.all([
    searchParams,
    raisableCompanies(actor),
    getRequestSettings(appContext),
    listRequestTypes(appContext, actor),
  ]);
  if (companies.length === 0) {
    notFound();
  }
  const asked = searchParam(params.company);
  const staff = getStaffPermissionsInCompanies(actor).has('requests:manage');

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description', {
          audience: staff ? 'staff' : 'company',
          staff: settings.staffName,
        })}
        back={{ href: '/requests', label: t('back') }}
      />
      <Card>
        <ClientMessages namespaces={['requests']}>
          <RaiseRequestForm
            // Only the types that can be picked: an archived one is for the requests that have it.
            types={types
              .filter(({ archived }) => !archived)
              .map(({ key, name, description }) => ({ key, name, description }))}
            companies={companies.map(({ slug, name }) => ({ slug, name }))}
            company={companies.find(({ slug }) => slug === asked)?.slug}
            choosesPriority={staff}
          />
        </ClientMessages>
      </Card>
    </>
  );
}

/**
 * The new request page.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function NewRequestPage({ searchParams }: PageProps<'/requests/new'>) {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Suspense fallback={<PageSkeleton />}>
        <NewRequest searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
