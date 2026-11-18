/**
 * @file The "Failed queued jobs" card on the Jobs page: the queued jobs
 * given up after their last attempt, latest first, sorted and paginated
 * (`FAILED_JOBS_TABLE`), with when each was given up, how often it was tried
 * and its last error's reference. Staff Admins also retry or discard each
 * one. Text from `admin.jobs.failed` and `admin.jobs.actions`.
 */
import { CircleCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import { paginationFooter } from '@/components/ui/pagination';
import RelativeTime from '@/components/ui/relative-time';
import RowAction from '@/components/ui/row-action';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { TableLinks } from '@/lib/tables/page-url';
import { type Paged } from '@/lib/tables/table-state';
import type { FailedJobSort } from '@/lib/tables/tables';
import type { FailedJobEntry } from '@/server/jobs';

import { discardFailedJobsAction, retryFailedJobsAction } from './actions';
import { ErrorReference, JobName } from './job-parts';

/**
 * A staff Admin's controls for a failed job: retry it (only when Adiutor
 * still has its kind, as no tick runs the others) or discard it after a
 * confirmation. Each button names the job and when it was given up, as a
 * table can list several jobs of a kind.
 *
 * @param props - Component props.
 * @param props.job - The job.
 * @returns The buttons.
 */
function Controls({ job }: { job: FailedJobEntry }) {
  const t = useTranslations('admin.jobs.actions');
  const tTime = useTranslations('common.relativeTime');
  const locale = useLocale();
  const labels = {
    job: job.kind,
    time: formatRelative(job.failedAt ?? job.queuedAt, locale, { justNow: tTime('justNow') }),
  };
  return (
    <>
      {job.known && (
        <RowAction
          action={retryFailedJobsAction}
          fields={{ id: job.id }}
          label={t('retry')}
          ariaLabel={t('retryLabel', labels)}
        />
      )}
      <RowAction
        action={discardFailedJobsAction}
        fields={{ id: job.id }}
        label={t('discard')}
        ariaLabel={t('discardLabel', labels)}
        variant="danger-subtle"
        confirm={{
          title: t('discardConfirm.title'),
          description: t('discardConfirm.description', { job: job.kind }),
          confirmLabel: t('discardConfirm.confirm'),
        }}
      />
    </>
  );
}

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
  /** Whether the viewer may retry and discard them (`jobs:manage`). */
  canManage: boolean;
}

/**
 * The failed queued jobs, or that there are none.
 *
 * @param props - Component props.
 * @param props.jobs - The page of failed jobs.
 * @param props.table - The table's links.
 * @param props.canLookUp - Whether the viewer may look up errors.
 * @param props.canManage - Whether the viewer may retry and discard them.
 * @returns The card.
 */
export default function FailedJobsCard({ jobs, table, canLookUp, canManage }: FailedJobsCardProps) {
  const t = useTranslations('admin.jobs.failed');
  const locale = useLocale();
  return (
    <Card
      id={table.section}
      title={t('title')}
      description={t('description')}
      actions={jobs.total > 0 && <SortMenu label={t('rows')} options={table.sortOptions()} />}
      flush={jobs.total > 0}
      footer={paginationFooter(table, jobs, t('rows'))}
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
                      {canManage && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Controls job={job} />
                        </div>
                      )}
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
