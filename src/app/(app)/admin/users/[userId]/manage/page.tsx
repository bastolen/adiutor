/**
 * @file The Manage tab of a user's page, served at
 * `/admin/users/[userId]/manage`: what can be done to the account, each when
 * the viewer may. Signing in as the user (staff Admins, Managers and Support,
 * when the rules allow it for this user, or saying why not), and, for staff
 * Admins on someone else's page, the account access (reset two-step
 * verification, which also disconnects their GitHub and Google accounts and
 * needs the Admin's recent confirmation, deactivate, and reactivate, which
 * needs it too when the account gets a staff role or a company's Admin role
 * back) and deleting the account. Staff who may do none of these, and everyone on
 * their own page, don't get the tab. The header and tabs come from the layout.
 */
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import { PageSkeleton } from '@/components/ui/skeleton';
import displayName from '@/lib/display-name';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';

import loadUser, { offersUserTab } from '../load-user';
import AccountAccessCard from './account-access-card';
import DeleteAccountCard from './delete-account-card';
import SignInAsCard from './sign-in-as-card';

/**
 * Page metadata: "Manage · User · Adiutor" for those who get the tab, and the
 * 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.user.manageTitle')
export const generateMetadata = globalPermissionMetadata(
  'users:view',
  'admin.user.manageTitle',
  async (actor, { params }: PageProps<'/admin/users/[userId]/manage'>) =>
    offersUserTab(actor, (await params).userId, 'manage'),
);

/**
 * Loads the user and shows what the viewer may do to their account.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 */
async function ManageUser({ params }: { params: Promise<{ userId: string }> }) {
  const actor = await requireGlobalPermission('users:view');
  const { userId } = await params;
  const { detail, access } = await loadUser(actor, userId, 'manage');
  const userName = displayName(detail);
  const page = `/admin/users/${detail.id}/manage`;

  return (
    <RecentConfirmationProvider
      required={actor.canConfirmSessions}
      // Each control adds its card's anchor.
      returnTo={page}
      {...confirmationWindow(actor.mfaConfirmedUntil)}
    >
      {access.signInAs && (
        <SignInAsCard
          userId={detail.id}
          userName={userName}
          verdict={access.signInAs}
          strongMfa={actor.strongMfa}
          strongMfaConfirmedUntil={actor.strongMfaConfirmedUntil}
          returnTo={page}
        />
      )}

      {access.canManage && (
        <AccountAccessCard
          userId={detail.id}
          userName={userName}
          mfa={detail.mfa}
          connectedAccounts={detail.connectedAccounts}
          deactivatedAt={detail.deactivatedAt}
          reactivationNeedsConfirmation={detail.reactivationNeedsConfirmation}
        />
      )}

      {access.canDelete && (
        <DeleteAccountCard userId={detail.id} userName={userName} email={detail.email} />
      )}
    </RecentConfirmationProvider>
  );
}

/**
 * The Manage tab of a user's page.
 */
export default function ManageUserPage({ params }: PageProps<'/admin/users/[userId]/manage'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <ManageUser params={params} />
    </Suspense>
  );
}
