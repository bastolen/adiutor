/**
 * @file The "Scheduled jobs" card on the Jobs page: every recurring job with
 * what it does, its schedule, how its last run went and when it runs next,
 * and when the last tick started;
 * staff Admins also run it now, pause it and resume it. The registry decides
 * the jobs and their order, so the table neither sorts nor pages. Text from
 * `admin.jobs.recurring` and `admin.jobs.actions`.
 */
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import RelativeTime from '@/components/ui/relative-time';
import RowAction from '@/components/ui/row-action';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatDateTime, formatRelative, formatTime, isSameDay } from '@/lib/format';
import type { Locale } from '@/lib/i18n/locales';
import useReaderTimeZone from '@/lib/i18n/use-reader-time-zone';
import type { RecurringJobOverview } from '@/server/jobs';

import { runJobAction } from './actions';
import {
  ErrorReference,
  JobName,
  PausedBadge,
  PauseToggle,
  RunStatusBadge,
  ScheduleText,
} from './job-parts';

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
  const timeZone = useReaderTimeZone();
  if (job.paused || !job.nextRunAt) {
    return <span>{t('whilePaused')}</span>;
  }
  if (job.due) {
    return <span>{t('atNextTick')}</span>;
  }
  const moment = job.nextRunAt.toISOString();
  // Today where the reader is: then the time alone says when.
  const today = isSameDay(job.nextRunAt, new Date(), timeZone);
  return (
    <time
      dateTime={moment}
      title={formatDateTime(job.nextRunAt, locale, timeZone)}
      className="whitespace-nowrap"
    >
      {today
        ? formatTime(job.nextRunAt, locale, timeZone)
        : formatDateTime(job.nextRunAt, locale, timeZone)}
    </time>
  );
}

/**
 * Makes the `<when>` tag of a rich message a `<time>` for a moment, with the
 * exact date and time as its tooltip.
 *
 * @param at - The moment.
 * @param locale - The reader's language.
 * @param timeZone - The reader's time zone.
 * @returns The renderer `t.rich` takes for the tag.
 */
function timeTag(at: Date, locale: Locale, timeZone: string) {
  return function TimeTag(chunks: ReactNode) {
    return (
      <time dateTime={at.toISOString()} title={formatDateTime(at, locale, timeZone)}>
        {chunks}
      </time>
    );
  };
}

/**
 * When the last tick started ("Last tick 2 minutes ago"), or that none did.
 *
 * @param props - Component props.
 * @param props.at - When the last tick started, if one did.
 * @returns The wording.
 */
function LastTick({ at }: { at: Date | null }) {
  const t = useTranslations('admin.jobs.recurring');
  const tTime = useTranslations('common.relativeTime');
  const locale = useLocale();
  const timeZone = useReaderTimeZone();
  if (!at) {
    return <span className="text-sm text-muted-foreground">{t('noTick')}</span>;
  }
  return (
    <span className="text-sm whitespace-nowrap text-muted-foreground">
      {t.rich('lastTick', {
        time: formatRelative(at, locale, timeZone, { justNow: tTime('justNow') }),
        when: timeTag(at, locale, timeZone),
      })}
    </span>
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
 * A staff Admin's controls for a job: run it now (also while it's paused),
 * and pause or resume it, unless it keeps Adiutor secure (`pausable`).
 *
 * @param props - Component props.
 * @param props.job - The job.
 * @returns The buttons.
 */
function Controls({ job }: { job: RecurringJobOverview }) {
  const t = useTranslations('admin.jobs.actions');
  return (
    <>
      <RowAction
        action={runJobAction}
        fields={{ job: job.name }}
        label={t('runNow')}
        ariaLabel={t('runNowLabel', { job: job.name })}
        disabled={job.running}
      />
      <PauseToggle job={job} />
    </>
  );
}

/**
 * Props for {@link RecurringJobsCard}.
 */
interface RecurringJobsCardProps {
  /** The recurring jobs, in the order the tick runs them. */
  jobs: RecurringJobOverview[];
  /** When the last tick started, or `null` when none ran yet. */
  lastTickAt: Date | null;
  /** Whether the viewer may look up errors (`errors:view`). */
  canLookUp: boolean;
  /** Whether the viewer may run, pause and resume jobs (`jobs:manage`). */
  canManage: boolean;
}

/**
 * The scheduled jobs.
 *
 * @returns The card.
 */
export default function RecurringJobsCard({
  jobs,
  lastTickAt,
  canLookUp,
  canManage,
}: RecurringJobsCardProps) {
  const t = useTranslations('admin.jobs.recurring');
  const tStatus = useTranslations('admin.jobs.status');
  return (
    <Card
      id="scheduled-jobs"
      title={t('title')}
      description={t('description')}
      actions={<LastTick at={lastTickAt} />}
      flush
    >
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
                    {canManage && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Controls job={job} />
                      </div>
                    )}
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
