/**
 * @file The page that raises a request, served at `/requests/new`. For
 * everyone who may raise one somewhere: a company's Admins and Clients in
 * their own companies, and the staff who work on requests in any active
 * company, also for someone there (decision 0047), or as an internal request
 * (decision 0048). Everyone else gets the 404 page.
 */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Card from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import { INTERNAL_CHOICE } from '@/lib/requests';
import { type SearchParams, searchParam } from '@/lib/search-params';
import type { Actor } from '@/server/actor';
import appContext from '@/server/app-context';
import {
  getActor,
  getInternalRequestPermissions,
  getStaffPermissionsInCompanies,
} from '@/server/authz';
import { checkedPageMetadata } from '@/server/page-metadata';
import {
  getRequestSettings,
  listRaisableFor,
  listRequestCompanies,
  listRequestTypes,
} from '@/server/requests';

import RaiseRequestForm from './raise-request-form';

/**
 * Where someone may raise a request: the companies, and whether they may
 * raise an internal request (the staff who work on requests).
 *
 * @param actor - The acting user.
 * @returns The companies, and whether internal requests are theirs to raise.
 */
async function placesToRaise(actor: Actor) {
  const companies = await listRequestCompanies(appContext, actor);
  return {
    companies: companies.filter(({ canRaise }) => canRaise),
    internal: getInternalRequestPermissions(actor).has('requests:contribute'),
  };
}

/**
 * Page metadata: "New request · Adiutor" for those who may raise a request
 * somewhere, and the 404 page's title for everyone else, who get the 404
 * page.
 */
// i18n-check t('requests.new.title')
export const generateMetadata = checkedPageMetadata('requests.new.title', async (actor) => {
  const places = await placesToRaise(actor);
  return places.internal || places.companies.length > 0 ? {} : null;
});

/**
 * Loads and shows the form. The company in the address (`?company=`, from a
 * company's own list) is chosen already when it's one the viewer may raise a
 * request in, and so is an internal request (`INTERNAL_CHOICE`) for the
 * staff who may raise one. For the staff, the people a request in a company
 * that's chosen already can be raised for come with it; the form asks for
 * them when another company is chosen.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: `company`, a company's URL name or
 *   `INTERNAL_CHOICE`.
 */
async function NewRequest({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const t = await getTranslations('requests.new');
  const actor = await getActor();
  const [params, { companies, internal }, settings, types] = await Promise.all([
    searchParams,
    placesToRaise(actor),
    getRequestSettings(appContext),
    listRequestTypes(appContext, actor),
  ]);
  if (companies.length === 0 && !internal) {
    notFound();
  }
  const asked = searchParam(params.company);
  const staff = getStaffPermissionsInCompanies(actor).has('requests:manage');
  const [only] = companies;
  // With one company and no internal requests to raise, there's nothing to choose.
  const chosen =
    companies.length === 1 && only && !internal
      ? only
      : companies.find(({ slug }) => slug === asked);
  const raiseForChoices =
    staff && chosen ? await listRaisableFor(appContext, actor, chosen.id) : [];
  // Asked for, or the only place there is (before any company is registered).
  const startsInternal = internal && (asked === INTERNAL_CHOICE || companies.length === 0);

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
            raisesInternal={internal}
            company={startsInternal ? INTERNAL_CHOICE : chosen?.slug}
            choosesPriority={staff}
            raisesFor={staff}
            raiseForChoices={raiseForChoices}
          />
        </ClientMessages>
      </Card>
    </>
  );
}

/**
 * The new request page.
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
