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
  /** Whether the viewer may see recorded errors (staff Admins), which adds the tabs. */
  canViewErrors: boolean;
}

/**
 * The "Logs" heading, with tabs for the audit log and the errors when the
 * viewer may see both (staff Admins); Managers only get the audit log, so no
 * tabs. Its text comes from `admin.logs.header`.
 *
 * @param props - Header props.
 * @param props.canViewErrors - Whether the viewer may see recorded errors.
 * @returns The header.
 */
export default function LogsHeader({ canViewErrors }: LogsHeaderProps) {
  const t = useTranslations('admin.logs.header');
  return (
    <PageHeader
      title={t('title')}
      description={canViewErrors ? t('descriptionWithErrors') : t('description')}
    >
      {canViewErrors && (
        <SegmentTabNav
          label={t('tabsLabel')}
          items={[
            { href: '/admin/logs', label: t('auditTab'), segment: null },
            { href: '/admin/logs/errors', label: t('errorsTab'), segment: 'errors' },
          ]}
        />
      )}
    </PageHeader>
  );
}
