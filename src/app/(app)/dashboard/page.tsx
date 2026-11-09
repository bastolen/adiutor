/**
 * @file Dashboard, served at `/dashboard`. Staff get tiles for the users
 * and companies lists (and Admins one for the staff, and a warning when
 * users lost their provider MFA); company users only see a welcome until
 * their features exist. A note says what happened when users were sent here
 * after leaving the staff or a company, or stepping down (`AccessNotice`).
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';

import PageHeader from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import displayName from '@/lib/display-name';
import appContext from '@/server/app-context';
import { getActor, getGlobalPermissions } from '@/server/authz';
import { getProviderMfaWarning } from '@/server/people/users';

import AccessNotice from '../access-notice';
import MfaRecommendation from './mfa-recommendation';
import ProviderMfaWarning from './provider-mfa-warning';
import StaffShortcuts from './staff-shortcuts';

/**
 * Page metadata.
 */
export const metadata: Metadata = {
  title: 'Dashboard',
};

/**
 * Greets the user and, for staff, shows the shortcuts.
 *
 * @returns The dashboard content.
 */
async function Dashboard() {
  const actor = await getActor();
  const permissions = getGlobalPermissions(actor);
  const isStaff = permissions.has('users:view');
  const firstName = displayName(actor).split(' ')[0];

  // Recommended for everyone who isn't required to have MFA (those can't get here without it).
  const recommendation = !actor.mfaEnabled && <MfaRecommendation userId={actor.id} />;
  // For staff Admins: users who lost their MFA because a provider isn't configured here.
  const providerMfaWarning = isStaff ? await getProviderMfaWarning(appContext, actor) : null;

  if (!isStaff) {
    return (
      <>
        <PageHeader title={`Welcome, ${firstName}`} />
        <AccessNotice />
        {recommendation}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Open a company, or see everyone who uses Adiutor."
      />
      <AccessNotice />
      {recommendation}
      {providerMfaWarning && <ProviderMfaWarning warning={providerMfaWarning} />}
      <StaffShortcuts
        canManageStaff={permissions.has('staff:manage')}
        canViewLogs={permissions.has('audit:view')}
      />
    </>
  );
}

/**
 * The dashboard page.
 *
 * @returns The page.
 */
export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}
