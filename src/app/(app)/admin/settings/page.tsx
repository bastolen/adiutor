/**
 * @file The General tab of Settings, served at `/admin/settings`: how users
 * see the staff and what they read in. First the name the staff shows users,
 * Adiutor's languages (the default and the ones it offers) and its default
 * time zone, then the appearance cards (`appearance/`: the logo, the browser
 * tab icon and the brand colours). Platform Admins only (`staff:manage`).
 * The heading and tabs come from the Settings layout; decision 0055 says
 * which settings go on this tab.
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Card from '@/components/ui/card';
import { PageSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import { timeZoneOptions } from '@/lib/i18n/time-zones';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { getStaffSettings } from '@/server/people/staff';

import AppearanceSettings from './appearance/appearance-cards';
import DefaultTimeZoneForm from './default-time-zone-form';
import LanguagesForm from './languages-form';
import StaffNameForm from './staff-name-form';

/**
 * Page metadata: "Settings · Adiutor" for those who may see the page
 * (`staff:manage`), and the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.settings.title')
export const generateMetadata = globalPermissionMetadata('staff:manage', 'admin.settings.title');

/**
 * Loads and shows the general settings. Its text comes from
 * `admin.settings.general` (the Languages card names the staff by their
 * saved name), which the forms (`StaffNameForm`, `LanguagesForm` and
 * `DefaultTimeZoneForm`) also get through `ClientMessages`.
 */
async function GeneralSettings() {
  const t = await getTranslations('admin.settings.general');
  const actor = await requireGlobalPermission('staff:manage');
  const settings = await getStaffSettings(appContext, actor);
  return (
    <ClientMessages namespaces={['admin.settings.general']}>
      <Card title={t('name.title')} description={t('name.description')}>
        <StaffNameForm name={settings.name} />
      </Card>

      <Card
        title={t('languages.title')}
        description={t('languages.description', { staff: settings.name })}
      >
        <LanguagesForm defaultLocale={settings.defaultLocale} offered={settings.offeredLocales} />
      </Card>

      <Card title={t('timeZone.title')} description={t('timeZone.description')}>
        <DefaultTimeZoneForm
          defaultTimeZone={settings.defaultTimeZone}
          options={timeZoneOptions(new Date(), settings.defaultTimeZone)}
        />
      </Card>
    </ClientMessages>
  );
}

/**
 * The General tab of Settings: the general cards, then the appearance
 * cards, which load side by side and show together.
 */
export default function GeneralSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <GeneralSettings />
      <AppearanceSettings />
    </Suspense>
  );
}
