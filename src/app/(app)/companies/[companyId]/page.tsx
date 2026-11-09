/**
 * @file Company overview, served at `/companies/[companyId]`. This is where
 * the company's requests (tickets) will live. Its title is the company's name
 * (the company layout's default title).
 */
import { Eye, Inbox } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Alert from '@/components/ui/alert';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { requireCompanyAccess } from '@/server/authz';

import AccessNotice from '../../access-notice';

/**
 * The overview for a company the user may see. Requests will live here; until
 * they're built, it explains what's coming, worded for whoever is looking:
 * staff viewing a company, a company member, or a
 * Watcher. Its text comes from the `companies` namespace.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @returns The overview.
 */
async function Overview({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const t = await getTranslations('companies.overview');
  const { company, permissions, actor } = await requireCompanyAccess(companyId);
  const role = actor.memberships[company.id] ?? null;
  // Staff (in a company they aren't a member of) and company members who
  // can work on requests see what's coming; other company members (Watchers) can only follow.
  let empty = {
    icon: Inbox,
    title: t('title'),
    description: t('description'),
  };
  if (!role) {
    empty = { ...empty, description: t('staffDescription', { company: company.name }) };
  } else if (!permissions.has('app:use')) {
    empty = {
      icon: Eye,
      title: t('viewOnlyTitle'),
      description: t('viewOnlyDescription'),
    };
  }

  return (
    <>
      {/* After stepping down on the Members page, which only Admins see. */}
      <AccessNotice />
      {company.deactivatedAt && <Alert tone="info">{t('deactivated')}</Alert>}
      <Card flush>
        <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
      </Card>
    </>
  );
}

/**
 * The company overview page.
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @returns The page.
 */
export default function CompanyPage({ params }: PageProps<'/companies/[companyId]'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <Overview params={params} />
    </Suspense>
  );
}
