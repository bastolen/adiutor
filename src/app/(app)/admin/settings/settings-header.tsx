/**
 * @file Heading and tabs of the Settings pages, rendered by their layout
 * (`layout.tsx`), so they stay while the tabs change.
 */
import { useTranslations } from 'next-intl';

import PageHeader from '@/components/ui/page-header';
import SegmentTabNav from '@/components/ui/segment-tab-nav';

/**
 * The "Settings" heading, with a tab for each of its pages: General (the
 * name shown to users, the languages and the time zone), Staff (the staff,
 * their invitations and invite links) and Requests (request numbers and
 * types). Every tab is for staff Admins, who are the only ones to see the
 * settings, so none is left out. Its text comes from `admin.settings`.
 */
export default function SettingsHeader() {
  const t = useTranslations('admin.settings');
  return (
    <PageHeader title={t('title')} description={t('description')}>
      <SegmentTabNav
        label={t('sections')}
        items={[
          { href: '/admin/settings', label: t('tabs.general'), segment: null },
          { href: '/admin/settings/staff', label: t('tabs.staff'), segment: 'staff' },
          { href: '/admin/settings/requests', label: t('tabs.requests'), segment: 'requests' },
        ]}
      />
    </PageHeader>
  );
}
