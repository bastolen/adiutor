/**
 * @file The General tab of Settings, served at `/admin/settings`: the name
 * the staff shows users, Adiutor's languages (the default and the ones it
 * offers) and its default time zone. Platform Admins only (`staff:manage`).
 * The heading and tabs come from the Settings layout.
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
 * `admin.settings.general`, which the forms (`StaffNameForm`, `LanguagesForm`
 * and `DefaultTimeZoneForm`) also get through `ClientMessages`.
 *
 * @returns The page content.
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

      <Card title={t('languages.title')} description={t('languages.description')}>
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
 * The General tab of Settings.
 *
 * @returns The page.
 */
export default function GeneralSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <GeneralSettings />
    </Suspense>
  );
}
