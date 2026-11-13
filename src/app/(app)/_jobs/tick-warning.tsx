/**
 * @file The warning that background jobs aren't running: no tick started in
 * a while, or none ever did (`isTickLate`). Shown on the Jobs page and, with
 * a link there, on the dashboard of staff who see the jobs, since no job can
 * email anyone once the ticks stop. Text from `admin.jobs.tickWarning`.
 */
import { AlarmClockOff } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import Banner from '@/components/ui/banner';
import Button from '@/components/ui/button';
import { formatRelative } from '@/lib/format';

/**
 * Props for {@link TickWarning}.
 */
interface TickWarningProps {
  /** When the last tick started, or `null` when none ran yet. */
  lastTickAt: Date | null;
  /** Whether to link to the Jobs page (on the dashboard). */
  linkToJobs?: boolean;
}

/**
 * Says how long ago the last tick started, or that none did, what that means
 * and where the ticks come from. It isn't dismissible: it goes once a tick
 * runs.
 *
 * @param props - Component props.
 * @param props.lastTickAt - When the last tick started, if one did.
 * @param props.linkToJobs - Whether to link to the Jobs page.
 * @returns The banner.
 */
export default function TickWarning({ lastTickAt, linkToJobs = false }: TickWarningProps) {
  const t = useTranslations('admin.jobs.tickWarning');
  const tTime = useTranslations('common.relativeTime');
  const locale = useLocale();
  return (
    <Banner
      label={t('label')}
      icon={AlarmClockOff}
      tone="warning"
      title={t('title')}
      description={
        lastTickAt
          ? t('late', { time: formatRelative(lastTickAt, locale, { justNow: tTime('justNow') }) })
          : t('never')
      }
      actions={
        linkToJobs && (
          <Button asChild variant="secondary" size="sm">
            <Link href="/admin/logs/jobs">{t('action')}</Link>
          </Button>
        )
      }
    />
  );
}
