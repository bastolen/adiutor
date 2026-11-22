/**
 * @file Layout of a user's page: the user's header, the notices that hold on
 * every tab (a deactivated account, your own account) and the tabs the
 * viewer gets (Overview, Companies, Activity, Manage; `userPageAccess`), then
 * the tab's page. Layouts stay mounted while the pages under them change, so
 * choosing a tab keeps focus on it and the header doesn't reload. Staff only
 * (`users:view`); each page checks again, and ends on the 404 page for a tab
 * the viewer doesn't get.
 */
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';

import Alert from '@/components/ui/alert';
import { PageHeaderSkeleton } from '@/components/ui/skeleton';
import TextLink from '@/components/ui/text-link';
import { formatDateTime } from '@/lib/format';
import { getGlobalPermissions, requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';

import loadUser from './load-user';
import UserHeader from './user-header';

/**
 * Metadata: nothing of its own for those who may see users (`users:view`), so
 * its pages keep their titles; for everyone else, who get the 404 page, every
 * page below it has the 404 page's title.
 */
export const generateMetadata = globalPermissionMetadata('users:view');

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
 * The link to the staff settings inside the "your own account" notice.
 *
 * @param chunks - The link's text.
 * @returns The link.
 */
function staffLink(chunks: ReactNode) {
  return <TextLink href="/admin/settings/staff">{chunks}</TextLink>;
}

/**
 * Loads the user (the 404 page when there's no such user) and shows their
 * header, the notices and the tabs.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @returns The header.
 */
async function UserHeaderLoader({ params }: { params: Promise<{ userId: string }> }) {
  const actor = await requireGlobalPermission('users:view');
  const [{ userId }, locale, timeZone, t] = await Promise.all([
    params,
    getLocale(),
    getTimeZone(),
    getTranslations('admin.user'),
  ]);
  const { detail, isSelf, access } = await loadUser(actor, userId);
  return (
    <>
      <UserHeader user={detail} tabs={access.tabs} />
      {detail.deactivatedAt && (
        <Alert tone="error">
          {t('deactivatedNotice', { date: formatDateTime(detail.deactivatedAt, locale, timeZone) })}
        </Alert>
      )}
      {isSelf && (
        <Alert tone="info">
          {getGlobalPermissions(actor).has('staff:manage')
            ? t.rich('self.signInAndStaff', { security: securityLink, staff: staffLink })
            : t.rich('self.signInOnly', { security: securityLink })}
        </Alert>
      )}
    </>
  );
}

/**
 * The user's header above the tab's page.
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page.
 * @param props.params - Route parameters.
 * @returns The layout.
 */
export default function UserLayout({ children, params }: LayoutProps<'/admin/users/[userId]'>) {
  return (
    <>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <UserHeaderLoader params={params} />
      </Suspense>
      {children}
    </>
  );
}
