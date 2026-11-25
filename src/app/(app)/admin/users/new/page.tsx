/**
 * @file The add-user page, served at `/admin/users/new`: registers an
 * account by email address, without companies or staff access. Staff Admins and
 * Managers only (`users:create`).
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Card from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { defaultLanguage } from '@/server/recipient-locale';

import RegisterUserForm from './register-user-form';

/**
 * Page metadata: "Add user · Adiutor" for those who may see the page (`users:create`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.addUser.title')
export const generateMetadata = globalPermissionMetadata('users:create', 'admin.addUser.title');

/**
 * Checks the permission, then shows the page's header and the form. The header is in here, not
 * in the page's static shell, because its text is translated per request.
 *
 * @returns The header and the form card.
 */
async function Register() {
  await requireGlobalPermission('users:create');
  const [t, defaultLocale] = await Promise.all([
    getTranslations('admin.addUser'),
    defaultLanguage(appContext),
  ]);
  return (
    <>
      <PageHeader
        title={t('heading')}
        description={t('description')}
        back={{ href: '/admin/users', label: t('back') }}
      />
      <Card>
        {/* The form's own text is in the `admin` namespace. */}
        <ClientMessages namespaces={['admin.addUser.form']}>
          <RegisterUserForm defaultLocale={defaultLocale} />
        </ClientMessages>
      </Card>
    </>
  );
}

/**
 * The add-user page.
 */
export default function NewUserPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Suspense fallback={<PageSkeleton />}>
        <Register />
      </Suspense>
    </div>
  );
}
