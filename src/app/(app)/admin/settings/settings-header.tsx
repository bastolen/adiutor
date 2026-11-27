/**
 * @file Heading and tabs of the Settings pages, rendered by their layout
 * (`layout.tsx`), so they stay while the tabs change.
 */
import { useTranslations } from 'next-intl';

import PageHeader from '@/components/ui/page-header';
import SegmentTabNav from '@/components/ui/segment-tab-nav';

/**
 * The "Settings" heading, with a tab for each of its pages (decision 0055):
 * General (how users see the staff: the name, the languages, the time zone,
 * the logo, the browser tab icon and the brand colours), Staff (the staff,
 * their invitations and invite links), Requests (request numbers and types)
 * and Integrations (what Adiutor works with outside itself: the mail server,
 * where attached files are kept, and the webhooks, whose pages keep
 * Integrations current).
 * Every tab is for staff Admins, who are the only ones to see the settings,
 * so none is left out. Its text comes from `admin.settings`.
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
            href: '/admin/settings/integrations',
            label: t('tabs.integrations'),
            segment: 'integrations',
            // A webhook's page, from the list on this tab.
            alsoOn: ['webhooks'],
          },
        ]}
      />
    </PageHeader>
  );
}
