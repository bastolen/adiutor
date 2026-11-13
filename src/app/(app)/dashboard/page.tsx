/**
 * @file Dashboard, served at `/dashboard`. Staff get a tile for each staff
 * section they may see (and Admins a warning when users lost their provider
 * MFA; Admins and Managers one when background jobs aren't running); company
 * users only see a welcome until
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
import { getTickWarning } from '@/server/jobs';
import { isMfaRecommendationDismissed } from '@/server/people/mfa-recommendation';
import { getProviderMfaWarning } from '@/server/people/users';

import TickWarning from '../_jobs/tick-warning';
import AccessNotice from '../access-notice';
import { staffSectionKeys } from '../staff-sections';
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

  // Recommended for everyone who isn't required to have MFA (those can't get here without it),
  // until they dismiss it: saved with the account, so it's known here and never pops in late.
  const recommendation = !actor.mfaEnabled &&
    !(await isMfaRecommendationDismissed(appContext, actor)) && (
      <ClientMessages namespaces={['dashboard.mfaRecommendation']}>
        <MfaRecommendation />
      </ClientMessages>
    );
  // For staff Admins: users who lost their MFA because a provider isn't configured here.
  const providerMfaWarning = isStaff ? await getProviderMfaWarning(appContext, actor) : null;
  // For staff who see the jobs: no job runs while the ticks are stopped, and none can say so.
  const tickWarning = isStaff ? await getTickWarning(appContext, actor) : null;

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
      {tickWarning && <TickWarning lastTickAt={tickWarning.lastTickAt} linkToJobs />}
      <StaffShortcuts sections={staffSectionKeys(permissions)} />
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
