/**
 * @file Layout of the Settings pages (General, Staff, Requests, Attachments,
 * Email, Webhooks and Appearance): the heading and tabs, then the page.
 * Layouts stay mounted while the pages under them change, so choosing a tab
 * keeps focus on it and the header doesn't reload. Only staff Admins (`staff:manage`) get here, and each page checks
 * the permission again for itself. On a wide screen every tab is wide
 * (`WidePage`), so the staff table gets the room, and the header and tabs
 * stay in one place from tab to tab.
 */
import { Suspense } from 'react';

import WidePage from '@/components/layout/wide-page';
import { PageHeaderSkeleton } from '@/components/ui/skeleton';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';

import SettingsHeader from './settings-header';

/**
 * Metadata: nothing of its own for those who may see the settings
 * (`staff:manage`), so its pages keep their titles; for everyone else, who get
 * the 404 page, every page below it has the 404 page's title.
 */
export const generateMetadata = globalPermissionMetadata('staff:manage');

/**
 * Checks the viewer may see the settings (the 404 page otherwise) and shows
 * the header with its tabs.
 */
async function SettingsHeaderLoader() {
  await requireGlobalPermission('staff:manage');
  return <SettingsHeader />;
}

/**
 * The Settings header above its pages, all of them as wide as the lists of
 * requests on a wide screen: Staff has the room, and a tab that widened on
 * its own would move the header and tabs from tab to tab.
 */
export default function SettingsLayout({ children }: LayoutProps<'/admin/settings'>) {
  return (
    <WidePage>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <SettingsHeaderLoader />
      </Suspense>
      {children}
    </WidePage>
  );
}
