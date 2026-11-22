/**
 * @file The Overview tab of a user's page, served at `/admin/users/[userId]`:
 * their account and sign-in security, and, for staff Admins on someone else's
 * page, their staff access. Staff can view it (`users:view`). The header,
 * notices and tabs come from the layout; the other tabs are Companies,
 * Activity and Manage, next to this file, each with its own cards.
 *
 * This file loads the user and decides what the viewer may do; each card is
 * its own component next to it (`*-card.tsx`), taking only what it shows.
 */
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import { PageSkeleton } from '@/components/ui/skeleton';
import displayName from '@/lib/display-name';
import ClientMessages from '@/lib/i18n/client-messages';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';

import AccountCard from './account-card';
import loadUser, { offersUserTab } from './load-user';
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
    offersUserTab(actor, (await params).userId, 'overview'),
);

/**
 * Loads the user and shows their Overview.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @returns The page content.
 */
async function UserOverview({ params }: { params: Promise<{ userId: string }> }) {
  const actor = await requireGlobalPermission('users:view');
  const { userId } = await params;
  const { detail, access } = await loadUser(actor, userId, 'overview');
  const userName = displayName(detail);

  return (
    <RecentConfirmationProvider
      required={actor.canConfirmSessions}
      // Each control adds its card's anchor.
      returnTo={`/admin/users/${detail.id}`}
      {...confirmationWindow(actor.mfaConfirmedUntil)}
    >
      <AccountCard
        email={detail.email}
        emailVerified={detail.emailVerified}
        deactivatedAt={detail.deactivatedAt}
        lastActiveAt={detail.lastActiveAt}
        createdAt={detail.createdAt}
      />

      <SecurityCard mfa={detail.mfa} accountNames={detail.accountNames} />

      {access.canManageStaff && (
        // The role select translates with `people`.
        <ClientMessages namespaces={['people.roleSelect']}>
          <StaffAccessCard userId={detail.id} userName={userName} staffRole={detail.staffRole} />
        </ClientMessages>
      )}
    </RecentConfirmationProvider>
  );
}

/**
 * The Overview tab of a user's page.
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @returns The page.
 */
export default function UserOverviewPage({ params }: PageProps<'/admin/users/[userId]'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <UserOverview params={params} />
    </Suspense>
  );
}
