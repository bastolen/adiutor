/**
 * @file Dashboard, served at `/dashboard`. Staff get tiles for the users
 * and companies lists (and Admins one for the staff, and a warning when
 * users lost their provider MFA); company users only see a welcome until
 * their features exist. A note says what happened when users were sent here
 * after leaving the staff or a company, or stepping down (`AccessNotice`).
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import PageHeader from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import displayName from '@/lib/display-name';
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { getActor, getGlobalPermissions } from '@/server/authz';
import { getProviderMfaWarning } from '@/server/people/users';

import AccessNotice from '../access-notice';
import MfaRecommendation from './mfa-recommendation';
import ProviderMfaWarning from './provider-mfa-warning';
import StaffShortcuts from './staff-shortcuts';

/**
 * Page metadata, with the title in the request's language.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('title') };
}

/**
 * Greets the user and, for staff, shows the shortcuts. Its text comes from
 * the `dashboard` namespace; the recommendation (a client component) gets it
 * through `ClientMessages`.
 *
 * @returns The dashboard content.
 */
async function Dashboard() {
  const t = await getTranslations('dashboard');
  const actor = await getActor();
  const permissions = getGlobalPermissions(actor);
  const isStaff = permissions.has('users:view');
  const firstName = displayName(actor).split(' ')[0] ?? '';

  // Recommended for everyone who isn't required to have MFA (those can't get here without it).
  const recommendation = !actor.mfaEnabled && (
    <ClientMessages namespaces={['dashboard.mfaRecommendation']}>
      <MfaRecommendation userId={actor.id} />
    </ClientMessages>
  );
  // For staff Admins: users who lost their MFA because a provider isn't configured here.
  const providerMfaWarning = isStaff ? await getProviderMfaWarning(appContext, actor) : null;

  if (!isStaff) {
    return (
      <>
        <PageHeader title={t('welcome', { name: firstName })} />
        <AccessNotice />
        {recommendation}
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('welcome', { name: firstName })} description={t('staffDescription')} />
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
