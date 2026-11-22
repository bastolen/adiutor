/**
 * @file Layout of the Settings pages (General, Staff and Requests): the
 * heading and tabs, then the page. Layouts stay mounted while the pages under
 * them change, so choosing a tab keeps focus on it and the header doesn't
 * reload. Only staff Admins (`staff:manage`) get here, and each page checks
 * the permission again for itself.
 */
import { Suspense } from 'react';

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
 *
 * @returns The header.
 */
async function SettingsHeaderLoader() {
  await requireGlobalPermission('staff:manage');
  return <SettingsHeader />;
}

/**
 * The Settings header above its pages.
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page.
 * @returns The layout.
 */
export default function SettingsLayout({ children }: LayoutProps<'/admin/settings'>) {
  return (
    <>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <SettingsHeaderLoader />
      </Suspense>
      {children}
    </>
  );
}
