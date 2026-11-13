/**
 * @file Layout of the Logs pages (the audit log, the errors and the
 * background jobs): the heading and tabs, then the page. Only staff who may
 * see the audit log (Admins and Managers) get here; the errors and jobs
 * pages also check their own permission (`errors:view` for staff Admins,
 * `jobs:view` for staff Admins and Managers).
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
 * header, with tabs for the other sections they may see.
 *
 * @returns The header.
 */
async function LogsHeaderLoader() {
  const actor = await requireGlobalPermission('audit:view');
  const permissions = getGlobalPermissions(actor);
  return (
    <LogsHeader
      canViewErrors={permissions.has('errors:view')}
      canViewJobs={permissions.has('jobs:view')}
    />
  );
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
