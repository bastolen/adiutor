/**
 * @file Heading and tabs of the Logs pages, rendered by their layout
 * (`layout.tsx`), so they stay while the tabs change.
 */
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
 * tabs.
 *
 * @param props - Header props.
 * @param props.canViewErrors - Whether the viewer may see recorded errors.
 * @returns The header.
 */
export default function LogsHeader({ canViewErrors }: LogsHeaderProps) {
  return (
    <PageHeader
      title="Logs"
      description={
        canViewErrors
          ? 'Security events by and about everyone, and the errors people ran into.'
          : 'Security events by and about everyone.'
      }
    >
      {canViewErrors && (
        <SegmentTabNav
          label="Log sections"
          items={[
            { href: '/admin/logs', label: 'Audit log', segment: null },
            { href: '/admin/logs/errors', label: 'Errors', segment: 'errors' },
          ]}
        />
      )}
    </PageHeader>
  );
}
