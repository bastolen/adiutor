/**
 * @file Heading and tabs of the Logs pages, rendered by their layout
 * (`layout.tsx`), so they stay while the tabs change.
 */
import { useTranslations } from 'next-intl';

import PageHeader from '@/components/ui/page-header';
import SegmentTabNav from '@/components/ui/segment-tab-nav';

/**
 * Props for {@link LogsHeader}.
 */
interface LogsHeaderProps {
  /** Whether the viewer may see recorded errors (staff Admins), which adds their tab. */
  canViewErrors: boolean;
  /** Whether the viewer may see the background jobs (staff Admins and Managers), which adds their tab. */
  canViewJobs: boolean;
}

/**
 * Which sections the header's description names (`admin.logs.header.description`).
 *
 * @param canViewErrors - Whether the viewer may see recorded errors.
 * @param canViewJobs - Whether the viewer may see the background jobs.
 * @returns The description's `sections` choice.
 */
function sectionsOf(canViewErrors: boolean, canViewJobs: boolean): string {
  if (canViewErrors && canViewJobs) {
    return 'errorsAndJobs';
  }
  if (canViewErrors) {
    return 'errors';
  }
  return canViewJobs ? 'jobs' : 'audit';
}

/**
 * The "Logs" heading, with a tab for the audit log and one for each other
 * section the viewer may see: the errors (staff Admins) and the background
 * jobs (staff Admins and Managers). With only the audit log, there are no
 * tabs. Its text comes from `admin.logs.header`.
 *
 * @param props - Header props.
 * @param props.canViewErrors - Whether the viewer may see recorded errors.
 * @param props.canViewJobs - Whether the viewer may see the background jobs.
 * @returns The header.
 */
export default function LogsHeader({ canViewErrors, canViewJobs }: LogsHeaderProps) {
  const t = useTranslations('admin.logs.header');
  const items = [
    { href: '/admin/logs', label: t('auditTab'), segment: null },
    ...(canViewErrors
      ? [{ href: '/admin/logs/errors', label: t('errorsTab'), segment: 'errors' }]
      : []),
    ...(canViewJobs ? [{ href: '/admin/logs/jobs', label: t('jobsTab'), segment: 'jobs' }] : []),
  ];
  return (
    <PageHeader
      title={t('title')}
      description={t('description', { sections: sectionsOf(canViewErrors, canViewJobs) })}
    >
      {items.length > 1 && <SegmentTabNav label={t('tabsLabel')} items={items} />}
    </PageHeader>
  );
}
