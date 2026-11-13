/**
 * @file The pieces the Jobs page's cards share: a job's name and what it
 * does, its status as a badge, its schedule in words, a run's counts, an
 * error's reference and the Pause or Resume button. Text from `admin.jobs`,
 * and from `jobs` for what each job does and counts.
 */
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import Badge, { type BadgeTone } from '@/components/ui/badge';
import RowAction from '@/components/ui/row-action';
import TextLink from '@/components/ui/text-link';
import type { JobRunStatus } from '@/db/schema';
import { formatTime } from '@/lib/format';
import { isJobName, isJobSummaryKey } from '@/lib/job-names';
import describeSchedule from '@/lib/job-schedule';

import { pauseJobAction, resumeJobAction } from './actions';

/**
 * A job's name as the command line, the docs and the emails write it, in a
 * monospace font, with what it does underneath in the reader's language.
 * A name Adiutor no longer has (a run kept in the history, the leftover
 * jobs of a removed kind) gets no description.
 *
 * @param props - Component props.
 * @param props.name - The recurring job or kind of queued job.
 * @param props.badges - Badges to show next to the name, e.g. "Paused".
 * @param props.describe - Whether to say what it does; the history leaves it out, as it repeats on every run.
 * @returns The name and description.
 */
export function JobName({
  name,
  badges = null,
  describe = true,
}: {
  name: string;
  badges?: ReactNode;
  describe?: boolean;
}) {
  const t = useTranslations('jobs');
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-medium wrap-anywhere text-foreground">{name}</span>
        {badges}
      </span>
      {describe && isJobName(name) && (
        <span className="text-sm text-muted-foreground">{t(`descriptions.${name}`)}</span>
      )}
    </span>
  );
}

/** The tone of each run status's badge. */
const STATUS_TONES: Record<JobRunStatus, BadgeTone> = {
  succeeded: 'success',
  failed: 'danger',
};

/**
 * How a run ended, as a badge ("Succeeded" or "Failed").
 *
 * @param props - Component props.
 * @param props.status - How it ended.
 * @returns The badge.
 */
export function RunStatusBadge({ status }: { status: JobRunStatus }) {
  const t = useTranslations('admin.jobs.status');
  const labels: Record<JobRunStatus, string> = {
    succeeded: t('succeeded'),
    failed: t('failed'),
  };
  return <Badge tone={STATUS_TONES[status]}>{labels[status]}</Badge>;
}

/**
 * "Paused", as a badge next to a job's name.
 *
 * @returns The badge.
 */
export function PausedBadge() {
  const t = useTranslations('admin.jobs.status');
  return <Badge tone="warning">{t('paused')}</Badge>;
}

/**
 * A staff Admin's Pause or Resume button for a recurring job or kind of
 * queued job; nothing for one that keeps Adiutor secure (`pausable`).
 *
 * @param props - Component props.
 * @param props.job - The job.
 * @param props.job.name - Its name.
 * @param props.job.pausable - Whether it can be paused.
 * @param props.job.paused - Whether it is.
 * @returns The button, or nothing.
 */
export function PauseToggle({
  job,
}: {
  job: { name: string; pausable: boolean; paused: boolean };
}) {
  const t = useTranslations('admin.jobs.actions');
  if (!job.pausable) {
    return null;
  }
  return job.paused ? (
    <RowAction
      action={resumeJobAction}
      fields={{ job: job.name }}
      label={t('resume')}
      ariaLabel={t('resumeLabel', { job: job.name })}
    />
  ) : (
    <RowAction
      action={pauseJobAction}
      fields={{ job: job.name }}
      label={t('pause')}
      ariaLabel={t('pauseLabel', { job: job.name })}
    />
  );
}

/**
 * A recurring job's schedule in words ("Every 5 minutes", "Every day at
 * 3:15 AM UTC"), or the cron expression when words can't say it.
 *
 * @param props - Component props.
 * @param props.schedule - The cron expression, in UTC.
 * @returns The schedule.
 */
export function ScheduleText({ schedule }: { schedule: string }) {
  const t = useTranslations('admin.jobs');
  const locale = useLocale();
  const words = describeSchedule(schedule);
  const values = { kind: words.kind, minutes: 0, minute: 0, time: '', expression: '' };
  switch (words.kind) {
    case 'minutes':
      return <>{t('schedule', { ...values, minutes: words.minutes })}</>;
    case 'hourly':
      return <>{t('schedule', { ...values, minute: words.minute })}</>;
    case 'daily': {
      const time = formatTime(new Date(Date.UTC(2026, 0, 1, words.hour, words.minute)), locale);
      return <>{t('schedule', { ...values, time })}</>;
    }
    default:
      return <>{t('schedule', { ...values, expression: words.expression })}</>;
  }
}

/**
 * What a run did, in words: each count it reports that isn't zero ("3 sent ·
 * 1 failed"), or "Nothing to do" for a run that succeeded. A failed run
 * without counts says nothing here: its error says what happened. Counts
 * Adiutor no longer has are left out.
 *
 * @param props - Component props.
 * @param props.summary - The run's counts.
 * @param props.status - How the run ended.
 * @returns The summary, or nothing.
 */
export function RunSummary({
  summary,
  status,
}: {
  summary: Readonly<Record<string, number | undefined>>;
  status: JobRunStatus;
}) {
  const t = useTranslations('jobs');
  const tJobs = useTranslations('admin.jobs');
  const parts = Object.entries(summary).flatMap(([key, count]) =>
    isJobSummaryKey(key) && typeof count === 'number' && count > 0
      ? [<span key={key}>{t(`summary.${key}`, { count })}</span>]
      : [],
  );
  if (parts.length === 0) {
    return status === 'succeeded' ? <span>{tJobs('nothingDone')}</span> : null;
  }
  return (
    <span className="flex flex-wrap gap-x-1.5">
      {parts.flatMap((part, index) =>
        // Each part has its own key; its separator takes it too.
        index === 0 ? [part] : [<span key={`before-${part.key}`}>·</span>, part],
      )}
    </span>
  );
}

/**
 * The reference of the error a run or job recorded: a link that looks it up
 * under Logs → Errors for staff who may (`errors:view`), plain text for the
 * others.
 *
 * @param props - Component props.
 * @param props.reference - The reference, e.g. `7KQ2-M9XD`.
 * @param props.canLookUp - Whether the viewer may see recorded errors.
 * @returns The reference.
 */
export function ErrorReference({
  reference,
  canLookUp,
}: {
  reference: string;
  canLookUp: boolean;
}) {
  const t = useTranslations('admin.jobs');
  const text = t('errorReference', { reference });
  if (!canLookUp) {
    return <span className="font-mono whitespace-nowrap">{text}</span>;
  }
  return (
    <TextLink
      href={`/admin/logs/errors?${new URLSearchParams({ q: reference }).toString()}`}
      className="font-mono whitespace-nowrap"
      aria-label={t('errorReferenceLink', { reference })}
    >
      {text}
    </TextLink>
  );
}
