/**
 * @file The "Recent runs" card on the Jobs page: every run of the last 30
 * days, newest first, sorted and paginated (`JOB_RUNS_TABLE`, the page's
 * main table), with what started it, how it ended and what it did. Text from
 * `admin.jobs.runs`.
 */
import { History } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import Pagination from '@/components/ui/pagination';
import RelativeTime from '@/components/ui/relative-time';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import TextLink from '@/components/ui/text-link';
import displayName from '@/lib/display-name';
import { formatDateTime } from '@/lib/format';
import type { TableLinks } from '@/lib/tables/page-url';
import { type Paged, showsPagination } from '@/lib/tables/table-state';
import type { JobRunSort } from '@/lib/tables/tables';
import type { JobRunEntry } from '@/server/jobs';

import { ErrorReference, JobName, RunStatusBadge, RunSummary } from './job-parts';

/**
 * Makes the `<link>` tag of a rich message a link to a user's page.
 *
 * @param userId - The user's ID.
 * @returns The renderer `t.rich` takes for the tag.
 */
function userLink(userId: string) {
  return function UserLink(chunks: ReactNode) {
    return <TextLink href={`/admin/users/${userId}`}>{chunks}</TextLink>;
  };
}

/**
 * What started a run: the tick, the command line, or a staff Admin on the
 * Jobs page (a link to their page while their account exists).
 *
 * @param props - Component props.
 * @param props.run - The run.
 * @returns The wording.
 */
function Trigger({ run }: { run: JobRunEntry }) {
  const t = useTranslations('admin.jobs.runs');
  const { startedBy } = run;
  if (run.trigger === 'page' && startedBy) {
    return (
      <span>
        {t.rich('startedBy', { name: displayName(startedBy), link: userLink(startedBy.id) })}
      </span>
    );
  }
  return <span>{t('trigger', { trigger: run.trigger })}</span>;
}

/**
 * Props for {@link JobRunsCard}.
 */
interface JobRunsCardProps {
  /** The page of runs to show. */
  runs: Paged<JobRunEntry>;
  /** The table's links (sorts and pages). */
  table: TableLinks<JobRunSort>;
  /** Whether the viewer may look up errors (`errors:view`). */
  canLookUp: boolean;
}

/**
 * The recent runs, or that there are none yet.
 *
 * @param props - Component props.
 * @param props.runs - The page of runs.
 * @param props.table - The table's links.
 * @param props.canLookUp - Whether the viewer may look up errors.
 * @returns The card.
 */
export default function JobRunsCard({ runs, table, canLookUp }: JobRunsCardProps) {
  const t = useTranslations('admin.jobs.runs');
  const locale = useLocale();
  return (
    <Card
      title={t('title')}
      description={t('description')}
      actions={runs.total > 0 && <SortMenu label={t('rows')} options={table.sortOptions()} />}
      flush={runs.total > 0}
      footer={showsPagination(runs.total) && <Pagination {...table.pagination(runs, t('rows'))} />}
    >
      {runs.total === 0 ? (
        <EmptyState icon={History} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Table caption={table.caption(t('caption'), runs)}>
          <thead>
            <tr>
              <Th>{t('job')}</Th>
              <Th aria-sort={table.ariaSort('time')} className="hidden sm:table-cell">
                {t('started')}
              </Th>
              <Th className="hidden md:table-cell">{t('outcome')}</Th>
            </tr>
          </thead>
          <tbody>
            {runs.items.map((run) => {
              const outcome = (
                <span className="flex flex-col items-start gap-1">
                  <RunStatusBadge status={run.status} />
                  <RunSummary summary={run.summary} status={run.status} />
                  {run.errorReference && (
                    <ErrorReference reference={run.errorReference} canLookUp={canLookUp} />
                  )}
                </span>
              );
              return (
                <Tr key={run.id}>
                  <Td>
                    <div className="flex flex-col items-start gap-1.5">
                      <JobName name={run.job} describe={false} />
                      <span className="text-sm text-muted-foreground">
                        <Trigger run={run} />
                      </span>
                      {/* Below the wider widths, when and how it ended go here. */}
                      <span className="text-xs text-muted-foreground sm:hidden">
                        <RelativeTime date={run.startedAt} />
                      </span>
                      <span className="text-sm text-muted-foreground md:hidden">{outcome}</span>
                    </div>
                  </Td>
                  <Td className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                    <RelativeTime date={run.startedAt} />
                    <span className="sr-only">, {formatDateTime(run.startedAt, locale)}</span>
                  </Td>
                  <Td className="hidden text-sm text-muted-foreground md:table-cell">{outcome}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
