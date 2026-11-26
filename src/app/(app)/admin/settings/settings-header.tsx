/**
 * @file Heading and tabs of the Settings pages, rendered by their layout
 * (`layout.tsx`), so they stay while the tabs change.
 */
import { useTranslations } from 'next-intl';

import PageHeader from '@/components/ui/page-header';
import SegmentTabNav from '@/components/ui/segment-tab-nav';

/**
 * The "Settings" heading, with a tab for each of its pages: General (the
 * name shown to users, the languages, the time zone, the logo, the browser
 * tab icon and the brand colours), Staff (the staff, their invitations and
 * invite links), Requests (request numbers and types), Attachments (where
 * attached files are kept, and the largest file), Email (the mail server
 * emails go out through) and Webhooks (where what happens to requests is
 * sent). Every tab is for staff Admins, who are the only ones to see the
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
          {
            href: '/admin/settings/attachments',
            label: t('tabs.attachments'),
            segment: 'attachments',
          },
          { href: '/admin/settings/email', label: t('tabs.email'), segment: 'email' },
          { href: '/admin/settings/webhooks', label: t('tabs.webhooks'), segment: 'webhooks' },
        ]}
      />
    </PageHeader>
  );
}
