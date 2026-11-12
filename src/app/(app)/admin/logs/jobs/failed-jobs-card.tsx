/**
 * @file The "Failed queued jobs" card on the Jobs page: the queued jobs
 * given up after their last attempt, latest first, sorted and paginated
 * (`FAILED_JOBS_TABLE`), with when each was given up, how often it was tried
 * and its last error's reference. Text from `admin.jobs.failed`.
 */
import { CircleCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import Pagination from '@/components/ui/pagination';
import RelativeTime from '@/components/ui/relative-time';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import type { TableLinks } from '@/lib/tables/page-url';
import { type Paged, showsPagination } from '@/lib/tables/table-state';
import type { FailedJobSort } from '@/lib/tables/tables';
import type { FailedJobEntry } from '@/server/jobs';

import { ErrorReference, JobName } from './job-parts';

/**
 * Props for {@link FailedJobsCard}.
 */
interface FailedJobsCardProps {
  /** The page of failed jobs to show. */
  jobs: Paged<FailedJobEntry>;
  /** The table's links (sorts and pages). */
  table: TableLinks<FailedJobSort>;
  /** Whether the viewer may look up errors (`errors:view`). */
  canLookUp: boolean;
}

/**
 * The failed queued jobs, or that there are none.
 *
 * @param props - Component props.
 * @param props.jobs - The page of failed jobs.
 * @param props.table - The table's links.
 * @param props.canLookUp - Whether the viewer may look up errors.
 * @returns The card.
 */
export default function FailedJobsCard({ jobs, table, canLookUp }: FailedJobsCardProps) {
  const t = useTranslations('admin.jobs.failed');
  const locale = useLocale();
  return (
    <Card
      id={table.section}
      title={t('title')}
      description={t('description')}
      actions={jobs.total > 0 && <SortMenu label={t('rows')} options={table.sortOptions()} />}
      flush={jobs.total > 0}
      footer={showsPagination(jobs.total) && <Pagination {...table.pagination(jobs, t('rows'))} />}
    >
      {jobs.total === 0 ? (
        <EmptyState
          icon={CircleCheck}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
        />
      ) : (
        <Table caption={table.caption(t('caption'), jobs)}>
          <thead>
            <tr>
              <Th>{t('job')}</Th>
              <Th aria-sort={table.ariaSort('time')} className="hidden sm:table-cell">
                {t('givenUp')}
              </Th>
              <Th className="hidden md:table-cell">{t('error')}</Th>
            </tr>
          </thead>
          <tbody>
            {jobs.items.map((job) => {
              const error = job.errorReference && (
                <ErrorReference reference={job.errorReference} canLookUp={canLookUp} />
              );
              return (
                <Tr key={job.id}>
                  <Td>
                    <div className="flex flex-col items-start gap-1.5">
                      <JobName name={job.kind} />
                      <span className="text-xs text-muted-foreground">
                        {t('attempts', { count: job.attempts })}
                      </span>
                      {/* Below the wider widths, when and the error go here. */}
                      <span className="text-xs text-muted-foreground sm:hidden">
                        <RelativeTime date={job.failedAt} />
                      </span>
                      {error && <span className="text-sm md:hidden">{error}</span>}
                    </div>
                  </Td>
                  <Td className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                    <RelativeTime date={job.failedAt} />
                    {job.failedAt && (
                      <span className="sr-only">, {formatDateTime(job.failedAt, locale)}</span>
                    )}
                  </Td>
                  <Td className="hidden text-sm md:table-cell">{error}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
