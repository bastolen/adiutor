/**
 * @file The Jobs page, served at `/admin/logs/jobs`, for staff Admins and
 * Managers (`jobs:view`): the scheduled jobs with how their last run went
 * and when they run next, the kinds of queued job with how many wait and
 * failed, the queued jobs that were given up, and every run of the last 30
 * days (see docs/jobs.md).
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PageSkeleton } from '@/components/ui/skeleton';
import type { SearchParams } from '@/lib/search-params';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState } from '@/lib/tables/table-state';
import { FAILED_JOBS_TABLE, JOB_RUNS_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { getGlobalPermissions, requireGlobalPermission } from '@/server/authz';
import { listFailedJobs, listJobRuns, loadJobsOverview } from '@/server/jobs';
import { globalPermissionMetadata } from '@/server/page-metadata';

import FailedJobsCard from './failed-jobs-card';
import JobRunsCard from './job-runs-card';
import QueuedJobsCard from './queued-jobs-card';
import RecurringJobsCard from './recurring-jobs-card';

/**
 * Page metadata: "Jobs · Adiutor" for those who may see the page (`jobs:view`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.jobs.title')
export const generateMetadata = globalPermissionMetadata('jobs:view', 'admin.jobs.title');

/**
 * Loads the jobs, the failed queued jobs and the runs, and shows them.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: the two tables' states.
 * @returns The page content.
 */
async function Jobs({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireGlobalPermission('jobs:view');
  const canLookUp = getGlobalPermissions(actor).has('errors:view');
  const params = await searchParams;
  const runsState = parseTableState(JOB_RUNS_TABLE, params);
  const failedState = parseTableState(FAILED_JOBS_TABLE, params);
  const [overview, runs, failed] = await Promise.all([
    loadJobsOverview(appContext, actor),
    listJobRuns(appContext, actor, runsState),
    listFailedJobs(appContext, actor, failedState),
  ]);
  const url = createPageUrl('/admin/logs/jobs', {}, await getTranslations('tables'));
  // Both tables first, so each link keeps the other's state.
  const failedTable = url.table(FAILED_JOBS_TABLE, { ...failedState, page: failed.page });
  const runsTable = url.table(JOB_RUNS_TABLE, { ...runsState, page: runs.page });

  return (
    <>
      <RecurringJobsCard jobs={overview.recurring} canLookUp={canLookUp} />
      <QueuedJobsCard kinds={overview.queued} />
      <FailedJobsCard jobs={failed} table={failedTable} canLookUp={canLookUp} />
      <JobRunsCard runs={runs} table={runsTable} canLookUp={canLookUp} />
    </>
  );
}

/**
 * The Jobs page.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function JobsPage({ searchParams }: PageProps<'/admin/logs/jobs'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <Jobs searchParams={searchParams} />
    </Suspense>
  );
}
