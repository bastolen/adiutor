/**
 * @file The Companies tab of a user's page, served at
 * `/admin/users/[userId]/companies`: the companies they belong to, sortable
 * and paginated, with their role in each. Staff can view it (`users:view`);
 * staff Admins and Managers (`members:manage` in companies) also add the
 * user to companies and change or remove their memberships, on their own
 * page too. The header and tabs come from the layout.
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import { PageSkeleton } from '@/components/ui/skeleton';
import displayName from '@/lib/display-name';
import ClientMessages from '@/lib/i18n/client-messages';
import type { SearchParams } from '@/lib/search-params';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState } from '@/lib/tables/table-state';
import { USER_COMPANIES_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { getStaffPermissionsInCompanies, requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { listAddableCompanies } from '@/server/people/members';
import { listUserCompanies } from '@/server/people/user-admin';

import loadUser, { offersUserTab } from '../load-user';
import CompaniesCard from './companies-card';

/**
 * Page metadata: "Companies · User · Adiutor" for those who may see users
 * (`users:view`) when the user exists, and the 404 page's title for everyone
 * else, who get the 404 page.
 */
// i18n-check t('admin.user.companiesTitle')
export const generateMetadata = globalPermissionMetadata(
  'users:view',
  'admin.user.companiesTitle',
  async (actor, { params }: PageProps<'/admin/users/[userId]/companies'>) =>
    offersUserTab(actor, (await params).userId, 'companies'),
);

/**
 * Loads the user's companies and shows them.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters: the table's sort and page (`USER_COMPANIES_TABLE`).
 * @returns The page content.
 */
async function UserCompanies({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireGlobalPermission('users:view');
  const [{ userId }, query] = await Promise.all([params, searchParams]);
  const { detail, isSelf } = await loadUser(actor, userId, 'companies');
  const requested = parseTableState(USER_COMPANIES_TABLE, query);
  // Your own companies too, as on a company's Members page: the services allow it, and the staff
  // Admins and Managers who may do it need MFA already, so becoming a company Admin ends no sessions.
  const canManageMembers = getStaffPermissionsInCompanies(actor).has('members:manage');
  const [companies, addable] = await Promise.all([
    listUserCompanies(appContext, actor, detail.id, requested),
    canManageMembers ? listAddableCompanies(appContext, actor, detail.id) : [],
  ]);
  const url = createPageUrl(
    `/admin/users/${detail.id}/companies`,
    {},
    await getTranslations('tables'),
  );
  const table = url.table(USER_COMPANIES_TABLE, { ...requested, page: companies.page });

  return (
    <RecentConfirmationProvider
      required={actor.canConfirmSessions}
      // The page with its table; the card adds its anchor.
      returnTo={url.current()}
      {...confirmationWindow(actor.mfaConfirmedUntil)}
    >
      {/* The role selects translate with `people`. */}
      <ClientMessages namespaces={['people.roleSelect']}>
        <CompaniesCard
          userId={detail.id}
          userName={displayName(detail)}
          isSelf={isSelf}
          userDeactivated={detail.deactivatedAt !== null}
          companies={companies}
          table={table}
          canManageMembers={canManageMembers}
          addable={addable}
        />
      </ClientMessages>
    </RecentConfirmationProvider>
  );
}

/**
 * The Companies tab of a user's page.
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function UserCompaniesPage({
  params,
  searchParams,
}: PageProps<'/admin/users/[userId]/companies'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <UserCompanies params={params} searchParams={searchParams} />
    </Suspense>
  );
}
