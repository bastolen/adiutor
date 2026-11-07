/**
 * @file Company overview, served at `/companies/[companyId]`. This is where
 * the company's requests (tickets) will live. Its title is the company's name
 * (the company layout's default title).
 */
import { Eye, Inbox } from 'lucide-react';
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
 * Watcher.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @returns The overview.
 */
async function Overview({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const { company, permissions, actor } = await requireCompanyAccess(companyId);
  const role = actor.memberships[company.id] ?? null;
  // Staff (in a company they aren't a member of) and company members who
  // can work on requests see what's coming; other company members (Watchers) can only follow.
  let empty = {
    icon: Inbox,
    title: 'Requests are on their way',
    description: "Soon you'll raise requests here, follow their progress and approve the work.",
  };
  if (!role) {
    empty = { ...empty, description: `Requests from ${company.name} will appear here.` };
  } else if (!permissions.has('app:use')) {
    empty = {
      icon: Eye,
      title: 'View-only access',
      description:
        "You have view-only access to this company. You'll be able to follow requests here.",
    };
  }

  return (
    <>
      {/* After stepping down on the Members page, which only Admins see. */}
      <AccessNotice />
      {company.deactivatedAt && (
        <Alert tone="info">
          This company is deactivated. Its people can&apos;t use Adiutor until it&apos;s
          reactivated.
        </Alert>
      )}
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
