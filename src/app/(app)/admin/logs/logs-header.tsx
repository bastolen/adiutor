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
 * The "Logs" heading, with a tab for the audit log and one for each other
 * section the viewer may see: the errors (staff Admins) and the background
 * jobs (staff Admins and Managers, so everyone who sees the logs). Its text
 * comes from `admin.logs.header`.
 *
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
      description={canViewErrors ? t('descriptionWithErrors') : t('description')}
    >
      <SegmentTabNav label={t('tabsLabel')} items={items} />
    </PageHeader>
  );
}
