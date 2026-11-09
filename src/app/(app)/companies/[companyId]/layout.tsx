/**
 * @file Layout of a company's pages (overview, Members, Settings): the
 * company's header and tabs, then the page. Layouts stay mounted while the
 * pages under them change, so choosing a tab keeps focus on it and the
 * header doesn't reload. Each page still checks the permission it needs.
 * The pages' titles name the company too ("Members · Adiutor Tests ·
 * Adiutor").
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageHeaderSkeleton } from '@/components/ui/skeleton';
import notFoundMetadata from '@/lib/not-found-metadata';
import { findCompanyAccess, requireCompanyAccess } from '@/server/authz';

import CompanyHeader from './company-header';

/**
 * Titles that name the company, so browser tabs, history and the route
 * announcer (which reads the title after each client-side navigation, when
 * it changed) tell companies apart. The pages below give their own part
 * (`'Members'`); the overview takes the default. The same check as the pages
 * comes first (cached per request), so a company's name never reaches
 * someone who may not see it: then every page is "Not found · Adiutor", like
 * the 404 page they get (the check doesn't end in the 404 page itself, which
 * would leave the page without a title). Pages that require a permission
 * check it for their own title too (`companyPermissionMetadata`).
 *
 * @param props - Layout props from Next.js.
 * @param props.params - Route parameters.
 * @returns The title template and default.
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
  return {
    title: { template: `%s · ${company.name} · Adiutor`, default: company.name },
  };
}

/**
 * Loads the company (the 404 page when the user can't see it) and shows its
 * header.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @returns The header.
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
 * The company's header above its pages.
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page.
 * @param props.params - Route parameters.
 * @returns The layout.
 */
export default function CompanyLayout({ children, params }: LayoutProps<'/companies/[companyId]'>) {
  return (
    <>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <CompanyHeaderLoader params={params} />
      </Suspense>
      {children}
    </>
  );
}
