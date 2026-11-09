/**
 * @file The user detail page, served at `/admin/users/[userId]`: a user's
 * account, sign-in security, companies, signed-in devices and recent
 * activity. Staff can view it; Admins and Managers also add the user to
 * companies and change or remove their memberships, and Admins change their
 * staff access, reset two-step verification (which also disconnects their
 * GitHub and Google accounts, and needs the Admin's recent confirmation: the
 * action sends them to the step-up page first), sign them out everywhere,
 * deactivate, reactivate and delete the account.
 *
 * On your own page, your companies are managed like anyone's, but the staff
 * access and account controls aren't shown: your sign-in methods are on your
 * Security page, and stepping down from the staff is on the Staff page.
 *
 * This file loads the user and decides what the viewer may do; each card is
 * its own component next to it (`*-card.tsx`), taking only what it shows.
 */
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Alert from '@/components/ui/alert';
import Avatar from '@/components/ui/avatar';
import PageHeader from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import TextLink from '@/components/ui/text-link';
import displayName from '@/lib/display-name';
import { formatDateTime } from '@/lib/format';
import ClientMessages from '@/lib/i18n/client-messages';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import type { SearchParams } from '@/lib/tables/search-params';
import { createPageUrl, parseTableState } from '@/lib/tables/table-state';
import { DEVICES_TABLE, USER_COMPANIES_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import {
  getGlobalPermissions,
  getStaffPermissionsInCompanies,
  requireGlobalPermission,
} from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { type AddableCompany, listAddableCompanies } from '@/server/people/members';
import { getUserDetail, type UserDetail, userExists } from '@/server/people/user-admin';

import { AccountStateBadges, StaffBadge } from '../user-badges';
import AccountAccessCard from './account-access-card';
import AccountCard from './account-card';
import ActivityCard from './activity-card';
import CompaniesCard from './companies-card';
import DeleteAccountCard from './delete-account-card';
import DevicesCard from './devices-card';
import SecurityCard from './security-card';
import StaffAccessCard from './staff-access-card';

/**
 * Page metadata: "User · Adiutor" for those who may see users (`users:view`)
 * when the user exists, and the 404 page's title for everyone else, who get
 * the 404 page. Unlike a company's pages, it doesn't name the user: titles
 * end up in the browser history, which holds no personal data.
 */
// i18n-check t('admin.user.title')
export const generateMetadata = globalPermissionMetadata(
  'users:view',
  'admin.user.title',
  async (actor, { params }: PageProps<'/admin/users/[userId]'>) =>
    userExists(appContext, actor, (await params).userId),
);

/**
 * The link to the viewer's Security page inside the "your own account" notice.
 *
 * @param chunks - The link's text.
 * @returns The link.
 */
function securityLink(chunks: ReactNode) {
  return <TextLink href="/account/security">{chunks}</TextLink>;
}

/**
 * The link to the Staff page inside the "your own account" notice.
 *
 * @param chunks - The link's text.
 * @returns The link.
 */
function staffLink(chunks: ReactNode) {
  return <TextLink href="/admin/staff">{chunks}</TextLink>;
}

/**
 * Loads and shows a user. On the viewer's own page it shows the companies
 * controls (worded for themselves) but not the staff access, account access
 * or delete controls.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters: the sort and page of their companies and
 *   signed-in devices (see `USER_COMPANIES_TABLE` and `DEVICES_TABLE`).
 * @returns The page content.
 */
async function UserDetailContent({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const locale = await getLocale();
  const t = await getTranslations('admin.user');
  const actor = await requireGlobalPermission('users:view');
  const [{ userId }, query] = await Promise.all([params, searchParams]);
  const companiesRequested = parseTableState(USER_COMPANIES_TABLE, query);
  const devicesRequested = parseTableState(DEVICES_TABLE, query);
  // Your own companies too, as on a company's Members page: the services allow it, and the staff
  // Admins and Managers who may do it need MFA already, so becoming a company Admin ends no sessions.
  const canManageMembers = getStaffPermissionsInCompanies(actor).has('members:manage');
  let detail: UserDetail;
  let addable: AddableCompany[];
  try {
    // Independent reads, so they run together; an unknown user ends on the 404 page either way.
    [detail, addable] = await Promise.all([
      getUserDetail(appContext, actor, userId, {
        companies: companiesRequested,
        sessions: devicesRequested,
      }),
      canManageMembers ? listAddableCompanies(appContext, actor, userId) : [],
    ]);
  } catch (error) {
    if (error instanceof ServiceError) {
      notFound();
    }
    throw error;
  }
  const url = createPageUrl(`/admin/users/${detail.id}`, {}, await getTranslations('tables'));

  const permissions = getGlobalPermissions(actor);
  const isSelf = detail.id === actor.id;
  // Not on your own page: you can only step down, which the Staff page offers.
  const canManageStaff = permissions.has('staff:manage') && !isSelf;
  // Account actions on yourself go through the Security page and its checks (`loadTarget`).
  const canManage = permissions.has('users:manage') && !isSelf;
  const canDelete = permissions.has('users:delete') && !isSelf;
  const userName = displayName(detail);
  const { sessions } = detail;
  // Every table first, so each link (and the return address) keeps the others' state.
  const companiesTable = url.table(USER_COMPANIES_TABLE, {
    ...companiesRequested,
    page: detail.companies.page,
  });
  const devicesTable = sessions
    ? url.table(DEVICES_TABLE, { ...devicesRequested, page: sessions.page })
    : null;

  return (
    <RecentConfirmationProvider
      required={actor.canConfirmSessions}
      // The page with its tables; each control adds its card's anchor.
      returnTo={url.current()}
      {...confirmationWindow(actor.mfaConfirmedUntil)}
    >
      <PageHeader
        back={{ href: '/admin/users', label: t('back') }}
        leading={<Avatar name={userName} size="lg" brand={detail.staffRole !== null} />}
        title={userName}
        description={detail.email}
      >
        <div className="flex flex-wrap items-center gap-2">
          {detail.staffRole && <StaffBadge role={detail.staffRole} />}
          <AccountStateBadges
            deactivated={detail.deactivatedAt !== null}
            emailVerified={detail.emailVerified}
          />
        </div>
      </PageHeader>

      {detail.deactivatedAt && (
        <Alert tone="error">
          {t('deactivatedNotice', { date: formatDateTime(detail.deactivatedAt, locale) })}
        </Alert>
      )}
      {isSelf && (
        <Alert tone="info">
          {permissions.has('staff:manage')
            ? t.rich('self.signInAndStaff', { security: securityLink, staff: staffLink })
            : t.rich('self.signInOnly', { security: securityLink })}
        </Alert>
      )}

      <AccountCard
        email={detail.email}
        emailVerified={detail.emailVerified}
        deactivatedAt={detail.deactivatedAt}
        lastActiveAt={detail.lastActiveAt}
        createdAt={detail.createdAt}
      />

      <SecurityCard mfa={detail.mfa} accountNames={detail.accountNames} />

      {canManageStaff && (
        // The role select in the card translates with `people`.
        <ClientMessages namespaces={['people.roleSelect']}>
          <StaffAccessCard userId={detail.id} userName={userName} staffRole={detail.staffRole} />
        </ClientMessages>
      )}

      {/* The role selects in the card translate with `people`. */}
      <ClientMessages namespaces={['people.roleSelect']}>
        <CompaniesCard
          userId={detail.id}
          userName={userName}
          isSelf={isSelf}
          companies={detail.companies}
          table={companiesTable}
          canManageMembers={canManageMembers}
          addable={addable}
        />
      </ClientMessages>

      {sessions && devicesTable && (
        <DevicesCard
          userId={detail.id}
          userName={userName}
          sessions={sessions}
          table={devicesTable}
          canSignOut={canManage}
        />
      )}

      {detail.activity && (
        <ActivityCard userId={detail.id} userName={userName} activity={detail.activity} />
      )}

      {canManage && (
        <AccountAccessCard
          userId={detail.id}
          userName={userName}
          mfa={detail.mfa}
          connectedAccounts={detail.connectedAccounts}
          deactivatedAt={detail.deactivatedAt}
        />
      )}

      {canDelete && (
        <DeleteAccountCard userId={detail.id} userName={userName} email={detail.email} />
      )}
    </RecentConfirmationProvider>
  );
}

/**
 * The user detail page.
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function UserDetailPage({
  params,
  searchParams,
}: PageProps<'/admin/users/[userId]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UserDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
