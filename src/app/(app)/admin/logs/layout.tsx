/**
 * @file Layout of the Logs pages (the audit log, and the errors): the
 * heading and tabs, then the page. Only staff who may see the audit log
 * (Admins and Managers) get here; the errors page also checks its own,
 * stricter permission (staff Admins).
 */
import { Suspense } from 'react';

import { PageHeaderSkeleton } from '@/components/ui/skeleton';
import { getGlobalPermissions, requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';

import LogsHeader from './logs-header';

/**
 * Metadata: nothing of its own for those who may see the logs (`audit:view`),
 * so its pages keep their titles; for everyone else, who get the 404 page,
 * every page below it has the 404 page's title.
 */
export const generateMetadata = globalPermissionMetadata('audit:view');

/**
 * Checks the viewer may see the logs (the 404 page otherwise) and shows the
 * header, with tabs when they may also see the errors.
 *
 * @returns The header.
 */
async function LogsHeaderLoader() {
  const actor = await requireGlobalPermission('audit:view');
  return <LogsHeader canViewErrors={getGlobalPermissions(actor).has('errors:view')} />;
}

/**
 * The Logs header above its pages.
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page.
 * @returns The layout.
 */
export default function LogsLayout({ children }: LayoutProps<'/admin/logs'>) {
  return (
    <>
      <Suspense fallback={<PageHeaderSkeleton />}>
        <LogsHeaderLoader />
      </Suspense>
      {children}
    </>
  );
}
