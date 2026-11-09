/**
 * @file Add a company, served at `/admin/companies/new`. Staff Admins and
 * Managers only (`company:create`).
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Card from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import { FormSkeleton, PageHeaderSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { defaultLanguage } from '@/server/recipient-locale';

import RegisterCompanyForm from './register-company-form';

/**
 * Page metadata: "Add company · Adiutor" for those who may see the page (`company:create`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.addCompany.title')
export const generateMetadata = globalPermissionMetadata(
  'company:create',
  'admin.addCompany.title',
);

/**
 * Checks the permission, then shows the heading and the form (text from
 * `admin.addCompany`; the form is a client component, so `admin` and
 * `people` go through `ClientMessages`).
 *
 * @returns The heading and the form card.
 */
async function Register() {
  const t = await getTranslations('admin');
  const actor = await requireGlobalPermission('company:create');
  const defaultLocale = await defaultLanguage(appContext);
  return (
    <>
      <PageHeader
        title={t('addCompany.heading')}
        description={t('addCompany.description')}
        back={{ href: '/admin/companies', label: t('companies.title') }}
      />
      {/* Its first Admin needs a recent confirmation (`grantNeedsConfirmation`): the form asks first. */}
      <RecentConfirmationProvider
        required={actor.canConfirmSessions}
        returnTo="/admin/companies/new"
        {...confirmationWindow(actor.mfaConfirmedUntil)}
      >
        <ClientMessages namespaces={['admin.addCompany.form', 'people']}>
          <Card>
            <RegisterCompanyForm defaultLocale={defaultLocale} />
          </Card>
        </ClientMessages>
      </RecentConfirmationProvider>
    </>
  );
}

/**
 * The add-company page.
 *
 * @returns The page.
 */
export default function NewCompanyPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Suspense
        fallback={
          <>
            <PageHeaderSkeleton />
            <FormSkeleton />
          </>
        }
      >
        <Register />
      </Suspense>
    </div>
  );
}
