/**
 * @file The "Scheduled jobs" card on the Jobs page: every recurring job with
 * what it does, its schedule, how its last run went and when it runs next.
 * The registry decides the jobs and their order, so the table neither sorts
 * nor pages. Text from `admin.jobs.recurring`.
 */
import { useLocale, useTranslations } from 'next-intl';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import RelativeTime from '@/components/ui/relative-time';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatDateTime, formatTime } from '@/lib/format';
import type { RecurringJobOverview } from '@/server/jobs';

import { ErrorReference, JobName, PausedBadge, RunStatusBadge, ScheduleText } from './job-parts';

/**
 * When a job runs next: at the next tick, at its next scheduled moment (only
 * the time when that's today in UTC), or not while it's paused.
 *
 * @param props - Component props.
 * @param props.job - The job.
 * @returns The wording.
 */
function NextRun({ job }: { job: RecurringJobOverview }) {
  const t = useTranslations('admin.jobs.recurring');
  const locale = useLocale();
  if (job.paused || !job.nextRunAt) {
    return <span>{t('whilePaused')}</span>;
  }
  if (job.due) {
    return <span>{t('atNextTick')}</span>;
  }
  const moment = job.nextRunAt.toISOString();
  const today = moment.slice(0, 10) === new Date().toISOString().slice(0, 10);
  return (
    <time dateTime={moment} title={formatDateTime(job.nextRunAt, locale)}>
      {today ? formatTime(job.nextRunAt, locale) : formatDateTime(job.nextRunAt, locale)}
    </time>
  );
}

/**
 * How a job's last run went: its status and when, how many runs in a row
 * failed, and the last error's reference; or that it hasn't run yet.
 *
 * @param props - Component props.
 * @param props.job - The job.
 * @param props.canLookUp - Whether the viewer may look up errors.
 * @returns The wording.
 */
function LastRun({ job, canLookUp }: { job: RecurringJobOverview; canLookUp: boolean }) {
  const t = useTranslations('admin.jobs.recurring');
  if (!job.lastStartedAt) {
    return <span>{t('neverRun')}</span>;
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex items-center gap-2 whitespace-nowrap">
        {job.lastStatus && <RunStatusBadge status={job.lastStatus} />}
        <RelativeTime date={job.lastStartedAt} />
      </span>
      {job.consecutiveFailures > 0 && (
        <span>{t('failuresInARow', { count: job.consecutiveFailures })}</span>
      )}
      {job.lastErrorReference && (
        <ErrorReference reference={job.lastErrorReference} canLookUp={canLookUp} />
      )}
    </span>
  );
}

/**
 * Props for {@link RecurringJobsCard}.
 */
interface RecurringJobsCardProps {
  /** The recurring jobs, in the order the tick runs them. */
  jobs: RecurringJobOverview[];
  /** Whether the viewer may look up errors (`errors:view`). */
  canLookUp: boolean;
}

/**
 * The scheduled jobs.
 *
 * @param props - Component props.
 * @param props.jobs - The recurring jobs.
 * @param props.canLookUp - Whether the viewer may look up errors.
 * @returns The card.
 */
export default function RecurringJobsCard({ jobs, canLookUp }: RecurringJobsCardProps) {
  const t = useTranslations('admin.jobs.recurring');
  const tStatus = useTranslations('admin.jobs.status');
  return (
    <Card id="scheduled-jobs" title={t('title')} description={t('description')} flush>
      <Table caption={t('caption')}>
        <thead>
          <tr>
            <Th>{t('job')}</Th>
            <Th className="hidden md:table-cell">{t('lastRun')}</Th>
            <Th className="hidden sm:table-cell">{t('nextRun')}</Th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const lastRun = <LastRun job={job} canLookUp={canLookUp} />;
            return (
              <Tr key={job.name}>
                <Td>
                  <div className="flex flex-col items-start gap-1.5">
                    <JobName
                      name={job.name}
                      badges={
                        <>
                          {job.paused && <PausedBadge />}
                          {job.running && <Badge>{tStatus('running')}</Badge>}
                        </>
                      }
                    />
                    <span className="text-xs text-muted-foreground">
                      <ScheduleText schedule={job.schedule} />
                    </span>
                    {/* Below the wider widths, the last and next run go here. */}
                    <span className="text-sm text-muted-foreground md:hidden">{lastRun}</span>
                    <span className="text-sm text-muted-foreground sm:hidden">
                      <NextRun job={job} />
                    </span>
                  </div>
                </Td>
                <Td className="hidden text-sm text-muted-foreground md:table-cell">{lastRun}</Td>
                <Td className="hidden text-sm text-muted-foreground sm:table-cell">
                  <NextRun job={job} />
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
