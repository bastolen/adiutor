/**
 * @file Heading and tabs shown at the top of every company page, rendered by
 * the company layout (`layout.tsx`), so they stay while the tabs change.
 */
import { useTranslations } from 'next-intl';

import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
import PageHeader from '@/components/ui/page-header';
import SegmentTabNav from '@/components/ui/segment-tab-nav';
import type { Permission } from '@/lib/authz/permissions';
import type { Role } from '@/lib/authz/roles';
import type { Company } from '@/server/authz';

/**
 * The company page tabs, with the route segment each opens (`null` for the
 * overview) and the permission each one needs.
 */
const TABS: readonly {
  segment: 'members' | 'settings' | null;
  permission: Permission;
}[] = [
  { segment: null, permission: 'company:view' },
  { segment: 'members', permission: 'members:view' },
  { segment: 'settings', permission: 'company:update' },
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
 * current one (from the URL) marked `aria-current="page"`. Its text comes
 * from the `companies` and `roles` namespaces.
 *
 * @param props - Header props.
 * @param props.company - The company.
 * @param props.permissions - The user's permissions there.
 * @param props.role - The user's own role there.
 * @returns The header.
 */
export default function CompanyHeader({ company, permissions, role }: CompanyHeaderProps) {
  const t = useTranslations('companies');
  const tRoles = useTranslations('roles');
  const labels = {
    overview: t('header.overview'),
    members: t('members.title'),
    settings: t('settings.title'),
  };
  const tabs = TABS.filter((tab) => permissions.has(tab.permission));
  return (
    <PageHeader
      title={company.name}
      leading={<Avatar name={company.name} size="lg" />}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          {role ? (
            <Badge>{tRoles(`${role}.label`)}</Badge>
          ) : (
            <Badge>{t('header.staffAccess')}</Badge>
          )}
          {company.deactivatedAt && <Badge tone="danger">{t('header.deactivated')}</Badge>}
        </span>
      }
    >
      {tabs.length > 1 && (
        <SegmentTabNav
          label={t('header.sections')}
          items={tabs.map((tab) => ({
            href: `/companies/${company.slug}${tab.segment ? `/${tab.segment}` : ''}`,
            label: labels[tab.segment ?? 'overview'],
            segment: tab.segment,
          }))}
        />
      )}
    </PageHeader>
  );
}
