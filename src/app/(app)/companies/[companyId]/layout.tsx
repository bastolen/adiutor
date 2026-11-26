/**
 * @file Layout of a company's pages (its requests, Members, Settings): the
 * company's header and tabs, then the page. Layouts stay mounted while the
 * pages under them change, so choosing a tab keeps focus on it and the
 * header doesn't reload. Each page still checks the permission it needs.
 * The pages' titles name the company too, then the staff ("Members ·
 * Adiutor Tests · Adiutor"). On a wide screen every tab is wide
 * (`WidePage`), so the company's list and board get the room, and the
 * header and tabs stay in one place from tab to tab.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import WidePage from '@/components/layout/wide-page';
import { PageHeaderSkeleton } from '@/components/ui/skeleton';
import notFoundMetadata from '@/lib/not-found-metadata';
import { findCompanyAccess, requireCompanyAccess } from '@/server/authz';
import { requestStaffName } from '@/server/branding';

import CompanyHeader from './company-header';

/**
 * Titles that name the company, so browser tabs, history and the route
 * announcer (which reads the title after each client-side navigation, when
 * it changed) tell companies apart. The pages below give their own part
 * ("Members"); the company's first page, which the template doesn't reach,
 * names the company itself. The same check as the pages comes first (cached per request), so a company's name never reaches
 * someone who may not see it: then every page is "Not found · Adiutor", like
 * the 404 page they get (the check doesn't end in the 404 page itself, which
 * would leave the page without a title). Pages that require a permission
 * check it for their own title too (`companyPermissionMetadata`). The
 * template is a message (`companies.titleTemplate`, with `%s` for the page's
 * own title and the staff's name at the end, as the root layout's template
 * ends), so each language orders its parts.
 *
 * @param props - Layout props from Next.js.
 * @param props.params - Route parameters.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ companyId: string }>;
}): Promise<Metadata> {
  const { companyId } = await params;
  const access = await findCompanyAccess(companyId);
  if (!access) {
    return notFoundMetadata();
  }
  const { company } = access;
  const [t, staff] = await Promise.all([getTranslations('companies'), requestStaffName()]);
  return {
    title: {
      template: t('titleTemplate', { company: company.name, staff }),
      default: company.name,
    },
  };
}

/**
 * Loads the company (the 404 page when the user can't see it) and shows its
 * header.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 */
async function CompanyHeaderLoader({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const { company, permissions, actor } = await requireCompanyAccess(companyId);
  return (
    <CompanyHeader
      company={company}
      permissions={permissions}
      role={actor.memberships[company.id] ?? null}
    />
  );
}

/**
 * The company's header above its pages, all of them as wide as a request's
 * page on a wide screen: the list and the board have the room, and a tab
 * that widened on its own would move the header and tabs from tab to tab.
 */
export default function CompanyLayout({ children, params }: LayoutProps<'/companies/[companyId]'>) {
  return (
    <WidePage>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <CompanyHeaderLoader params={params} />
      </Suspense>
      {children}
    </WidePage>
  );
}
