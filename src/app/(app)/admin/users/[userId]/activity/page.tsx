/**
 * @file The Activity tab of a user's page, served at
 * `/admin/users/[userId]/activity`: their signed-in devices (staff Admins,
 * `users:manage`, who also sign them out everywhere on someone else's page),
 * sortable and paginated, and their recent security events (staff who see
 * the audit log, `audit:view`). Staff with neither don't get the tab. The
 * header and tabs come from the layout.
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import { PageSkeleton } from '@/components/ui/skeleton';
import displayName from '@/lib/display-name';
import type { SearchParams } from '@/lib/search-params';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState } from '@/lib/tables/table-state';
import { USER_DEVICES_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { listAuditEvents } from '@/server/audit';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { listUserDevices } from '@/server/people/user-admin';

import loadUser, { offersUserTab } from '../load-user';
import ActivityCard from './activity-card';
import DevicesCard from './devices-card';

/** How many of their latest security events the tab shows. */
const RECENT_EVENTS = 25;

/**
 * Page metadata: "Activity · User · Adiutor" for those who get the tab, and
 * the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.user.activityTitle')
export const generateMetadata = globalPermissionMetadata(
  'users:view',
  'admin.user.activityTitle',
  async (actor, { params }: PageProps<'/admin/users/[userId]/activity'>) =>
    offersUserTab(actor, (await params).userId, 'activity'),
);

/**
 * Loads the user's devices and recent events, as far as the viewer may see
 * them, and shows them.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters: the devices table's sort and page
 *   (`USER_DEVICES_TABLE`).
 * @returns The page content.
 */
async function UserActivity({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireGlobalPermission('users:view');
  const [{ userId }, query] = await Promise.all([params, searchParams]);
  const { detail, access } = await loadUser(actor, userId, 'activity');
  const requested = parseTableState(USER_DEVICES_TABLE, query);
  const [devices, activity] = await Promise.all([
    access.seesDevices ? listUserDevices(appContext, actor, detail.id, requested) : null,
    access.seesActivity ? listAuditEvents(appContext, actor, detail.id, RECENT_EVENTS) : null,
  ]);
  const url = createPageUrl(
    `/admin/users/${detail.id}/activity`,
    {},
    await getTranslations('tables'),
  );
  const userName = displayName(detail);

  return (
    <RecentConfirmationProvider
      required={actor.canConfirmSessions}
      // The page with its table; the card adds its anchor.
      returnTo={url.current()}
      {...confirmationWindow(actor.mfaConfirmedUntil)}
    >
      {devices && (
        <DevicesCard
          userId={detail.id}
          userName={userName}
          sessions={devices}
          table={url.table(USER_DEVICES_TABLE, { ...requested, page: devices.page })}
          canSignOut={access.canManage}
        />
      )}

      {activity && <ActivityCard userId={detail.id} userName={userName} activity={activity} />}
    </RecentConfirmationProvider>
  );
}

/**
 * The Activity tab of a user's page.
 *
 * @returns The page.
 */
export default function UserActivityPage({
  params,
  searchParams,
}: PageProps<'/admin/users/[userId]/activity'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <UserActivity params={params} searchParams={searchParams} />
    </Suspense>
  );
}
