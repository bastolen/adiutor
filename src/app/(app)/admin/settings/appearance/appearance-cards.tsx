/**
 * @file The appearance cards of Settings' General tab (`../page.tsx`): the
 * logo and the browser tab icon (decision 0052), light and dark mode
 * (decision 0053) and the brand colours (decision 0049) every page and email
 * shows. Platform Admins only (`staff:manage`). They were the Appearance tab,
 * whose address now leads to the logo's card (decision 0055).
 */
import { getTranslations } from 'next-intl/server';

import Card from '@/components/ui/card';
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { getBrandColours, getBrandImageSettings, getForcedTheme } from '@/server/branding';

import ColoursForm from './colours-form';
import IconForm from './icon-form';
import LogoForm from './logo-form';
import ThemeForm from './theme-form';

/**
 * Loads and shows the logo, the browser tab icon, light and dark mode and
 * the brand colours, each in its card; the previews show only the mode every
 * page is kept in, when there's one. Its text comes from
 * `admin.settings.appearance`, which the
 * forms also get through `ClientMessages`, with `errors.branding` for the
 * files the browser refuses.
 */
export default async function AppearanceSettings() {
  const t = await getTranslations('admin.settings.appearance');
  const actor = await requireGlobalPermission('staff:manage');
  const [colours, images, forced] = await Promise.all([
    getBrandColours(appContext, actor),
    getBrandImageSettings(appContext, actor),
    getForcedTheme(appContext, actor),
  ]);
  return (
    <ClientMessages namespaces={['admin.settings.appearance', 'errors.branding']}>
      <Card id="logo" title={t('logo.title')} description={t('logo.description')}>
        <LogoForm logo={images.logo} colours={colours} forced={forced} />
      </Card>

      <Card id="icon" title={t('icon.title')} description={t('icon.description')}>
        <IconForm icon={images.icon} ownIcon={images.ownIcon} />
      </Card>

      <Card id="theme" title={t('theme.title')} description={t('theme.description')}>
        <ThemeForm saved={forced} />
      </Card>

      <Card id="colours" title={t('colours.title')} description={t('colours.description')}>
        <ColoursForm saved={colours} forced={forced} />
      </Card>
    </ClientMessages>
  );
}
