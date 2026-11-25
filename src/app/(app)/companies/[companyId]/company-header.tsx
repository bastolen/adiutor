/**
 * @file Heading and tabs shown at the top of every company page, rendered by
 * the company layout (`layout.tsx`), so they stay while the tabs change.
 */
import { useTranslations } from 'next-intl';

import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
import PageHeader from '@/components/ui/page-header';
import type { Permission } from '@/lib/authz/permissions';
import type { Role } from '@/lib/authz/roles';
import type { Company } from '@/server/authz';

import { NewRequestButton } from '../../_requests/request-list';
import CompanyTabs from './company-tabs';

/**
 * The company page tabs, with the route segment each opens (`null` for the
 * company's requests, its first page, a tab that stays current on the
 * company's board: `CompanyTabs`) and the permission each one needs.
 */
const TABS: readonly {
  segment: 'members' | 'settings' | null;
  permission: Permission;
}[] = [
  { segment: null, permission: 'requests:view' },
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
 * The company's name (the page's `h1`), the user's role, status badges, a
 * button to raise a request for those who may raise one there, and the tabs
 * they may open. The tabs are a navigation landmark, with the
 * current one (from the URL) marked `aria-current="page"`. Its text comes
 * from the `companies` and `roles` namespaces.
 */
export default function CompanyHeader({ company, permissions, role }: CompanyHeaderProps) {
  const t = useTranslations('companies');
  const tRoles = useTranslations('roles');
  const labels = {
    requests: t('header.requests'),
    members: t('members.title'),
    settings: t('settings.title'),
  };
  const tabs = TABS.filter((tab) => permissions.has(tab.permission));
  // Nobody raises a request in a deactivated company, whatever their rights.
  const canRaise = permissions.has('requests:contribute') && !company.deactivatedAt;
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
      actions={
        canRaise && <NewRequestButton company={company.slug} label={t('header.newRequest')} />
      }
    >
      {tabs.length > 1 && (
        <CompanyTabs
          label={t('header.sections')}
          items={tabs.map((tab) => ({
            href: `/companies/${company.slug}${tab.segment ? `/${tab.segment}` : ''}`,
            label: labels[tab.segment ?? 'requests'],
            segment: tab.segment,
          }))}
        />
      )}
    </PageHeader>
  );
}
