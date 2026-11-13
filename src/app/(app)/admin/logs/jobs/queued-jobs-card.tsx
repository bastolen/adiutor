/**
 * @file The "Queued jobs" card on the Jobs page: every kind of queued job
 * with what it does and how many of its jobs wait or failed, including kinds
 * Adiutor no longer has while their jobs are still there. Staff Admins also
 * pause and resume a kind, and retry or discard all its failed jobs. The
 * registry decides the kinds and their order, so the table neither sorts nor
 * pages. Text from `admin.jobs.queued` and `admin.jobs.actions`.
 */
import { useTranslations } from 'next-intl';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import RowAction from '@/components/ui/row-action';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import type { QueuedKindListing } from '@/server/jobs';

import {
  discardFailedJobsAction,
  pauseJobAction,
  resumeJobAction,
  retryFailedJobsAction,
} from './actions';
import { JobName, PausedBadge } from './job-parts';

/**
 * A staff Admin's controls for a kind: pause or resume it (only a kind
 * Adiutor still has, and not one that keeps people informed about their
 * security), and with failed jobs, retry them all (the same) or
 * discard them all after a confirmation.
 *
 * @param props - Component props.
 * @param props.kind - The kind.
 * @returns The buttons, or nothing when there's nothing to do.
 */
function Controls({ kind }: { kind: QueuedKindListing }) {
  const t = useTranslations('admin.jobs.actions');
  const job = kind.name;
  return (
    <>
      {kind.pausable &&
        (kind.paused ? (
          <RowAction
            action={resumeJobAction}
            fields={{ job }}
            label={t('resume')}
            ariaLabel={t('resumeLabel', { job })}
          />
        ) : (
          <RowAction
            action={pauseJobAction}
            fields={{ job }}
            label={t('pause')}
            ariaLabel={t('pauseLabel', { job })}
          />
        ))}
      {kind.failed > 0 && kind.known && (
        <RowAction
          action={retryFailedJobsAction}
          fields={{ kind: job }}
          label={t('retryAll')}
          ariaLabel={t('retryAllLabel', { job })}
        />
      )}
      {kind.failed > 0 && (
        <RowAction
          action={discardFailedJobsAction}
          fields={{ kind: job }}
          label={t('discardAll')}
          ariaLabel={t('discardAllLabel', { job })}
          variant="danger-subtle"
          confirm={{
            title: t('discardAllConfirm.title', { job }),
            description: t('discardAllConfirm.description', { count: kind.failed }),
            confirmLabel: t('discardAllConfirm.confirm'),
          }}
        />
      )}
    </>
  );
}

/**
 * Props for {@link QueuedJobsCard}.
 */
interface QueuedJobsCardProps {
  /** The kinds of queued job. */
  kinds: QueuedKindListing[];
  /** Whether the viewer may pause, resume, retry and discard (`jobs:manage`). */
  canManage: boolean;
}

/**
 * The kinds of queued job.
 *
 * @param props - Component props.
 * @param props.kinds - The kinds.
 * @param props.canManage - Whether the viewer may act on them.
 * @returns The card.
 */
export default function QueuedJobsCard({ kinds, canManage }: QueuedJobsCardProps) {
  const t = useTranslations('admin.jobs.queued');
  const tStatus = useTranslations('admin.jobs.status');
  const tActions = useTranslations('admin.jobs.actions');
  return (
    <Card id="queued-jobs" title={t('title')} description={t('description')} flush>
      <Table caption={t('caption')}>
        <thead>
          <tr>
            <Th>{t('kind')}</Th>
            <Th className="hidden text-right sm:table-cell">{t('waiting')}</Th>
            <Th className="hidden text-right sm:table-cell">{t('failed')}</Th>
            {canManage && (
              <Th className="hidden text-right sm:table-cell">
                <span className="sr-only">{tActions('column')}</span>
              </Th>
            )}
          </tr>
        </thead>
        <tbody>
          {kinds.map((kind) => (
            <Tr key={kind.name}>
              <Td>
                <div className="flex flex-col items-start gap-1.5">
                  <JobName
                    name={kind.name}
                    badges={
                      <>
                        {kind.paused && <PausedBadge />}
                        {!kind.known && <Badge>{tStatus('noLongerUsed')}</Badge>}
                      </>
                    }
                  />
                  {/* Below the wider widths, the counts go here. */}
                  <span className="text-sm text-muted-foreground sm:hidden">
                    {t('counts', { waiting: kind.waiting, failed: kind.failed })}
                  </span>
                  {/* On narrow screens, the controls go under the kind too. */}
                  {canManage && (
                    <div className="flex flex-wrap gap-2 pt-1 empty:hidden sm:hidden">
                      <Controls kind={kind} />
                    </div>
                  )}
                </div>
              </Td>
              <Td className="hidden text-right whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">
                {t('count', { count: kind.waiting })}
              </Td>
              <Td
                className={
                  kind.failed > 0
                    ? 'hidden text-right font-medium whitespace-nowrap text-danger tabular-nums sm:table-cell'
                    : 'hidden text-right whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell'
                }
              >
                {t('count', { count: kind.failed })}
              </Td>
              {canManage && (
                <Td className="hidden sm:table-cell">
                  <div className="flex flex-col items-end gap-2 lg:flex-row lg:justify-end">
                    <Controls kind={kind} />
                  </div>
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
