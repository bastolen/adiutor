/**
 * @file Heading and tabs shown at the top of every company page, rendered by
 * the company layout (`layout.tsx`), so they stay while the tabs change.
 */
import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
import PageHeader from '@/components/ui/page-header';
import SegmentTabNav from '@/components/ui/segment-tab-nav';
import type { Permission } from '@/lib/authz/permissions';
import { ROLE_LABELS, type Role } from '@/lib/authz/roles';
import type { Company } from '@/server/authz';

/**
 * The company page tabs, with the route segment each opens (`null` for the
 * overview) and the permission each one needs.
 */
const TABS: readonly { segment: string | null; label: string; permission: Permission }[] = [
  { segment: null, label: 'Overview', permission: 'company:view' },
  { segment: 'members', label: 'Members', permission: 'members:view' },
  { segment: 'settings', label: 'Settings', permission: 'company:update' },
];

/**
 * Props for {@link CompanyHeader}.
 */
interface CompanyHeaderProps {
  /** The company. */
  company: Company;
  /** The user's permissions there. */
  permissions: Set<Permission>;
  /** The user's own role there, or `null` (e.g. staff who aren't members). */
  role: Role | null;
}

/**
 * The company's name (the page's `h1`), the user's role, status badges and
 * the tabs they may open. The tabs are a navigation landmark, with the
 * current one (from the URL) marked `aria-current="page"`.
 *
 * @param props - Header props.
 * @param props.company - The company.
 * @param props.permissions - The user's permissions there.
 * @param props.role - The user's own role there.
 * @returns The header.
 */
export default function CompanyHeader({ company, permissions, role }: CompanyHeaderProps) {
  const tabs = TABS.filter((tab) => permissions.has(tab.permission));
  return (
    <PageHeader
      title={company.name}
      leading={<Avatar name={company.name} size="lg" />}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          {role ? <Badge>{ROLE_LABELS[role]}</Badge> : <Badge>Staff access</Badge>}
          {company.deactivatedAt && <Badge tone="danger">Deactivated</Badge>}
        </span>
      }
    >
      {tabs.length > 1 && (
        <SegmentTabNav
          label="Company sections"
          items={tabs.map((tab) => ({
            href: `/companies/${company.slug}${tab.segment ? `/${tab.segment}` : ''}`,
            label: tab.label,
            segment: tab.segment,
          }))}
        />
      )}
    </PageHeader>
  );
}
