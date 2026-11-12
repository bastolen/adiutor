/**
 * @file The "Queued jobs" card on the Jobs page: every kind of queued job
 * with what it does and how many of its jobs wait or failed, including kinds
 * Adiutor no longer has while their jobs are still there. The registry
 * decides the kinds and their order, so the table neither sorts nor pages.
 * Text from `admin.jobs.queued`.
 */
import { useTranslations } from 'next-intl';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import type { QueuedKindListing } from '@/server/jobs';

import { JobName, PausedBadge } from './job-parts';

/**
 * Props for {@link QueuedJobsCard}.
 */
interface QueuedJobsCardProps {
  /** The kinds of queued job. */
  kinds: QueuedKindListing[];
}

/**
 * The kinds of queued job.
 *
 * @param props - Component props.
 * @param props.kinds - The kinds.
 * @returns The card.
 */
export default function QueuedJobsCard({ kinds }: QueuedJobsCardProps) {
  const t = useTranslations('admin.jobs.queued');
  const tStatus = useTranslations('admin.jobs.status');
  return (
    <Card id="queued-jobs" title={t('title')} description={t('description')} flush>
      <Table caption={t('caption')}>
        <thead>
          <tr>
            <Th>{t('kind')}</Th>
            <Th className="hidden text-right sm:table-cell">{t('waiting')}</Th>
            <Th className="hidden text-right sm:table-cell">{t('failed')}</Th>
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
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
