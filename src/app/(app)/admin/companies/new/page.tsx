/**
 * @file Add a company, served at `/admin/companies/new`. Staff Admins and
 * Managers only (`company:create`).
 */
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Card from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import { FormSkeleton } from '@/components/ui/skeleton';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';

import RegisterCompanyForm from './register-company-form';

/**
 * Page metadata: "Add company · Adiutor" for those who may see the page (`company:create`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
export const generateMetadata = globalPermissionMetadata('company:create', {
  title: 'Add company · Adiutor',
});

/**
 * Checks the permission, then shows the form.
 *
 * @returns The form card.
 */
async function Register() {
  const actor = await requireGlobalPermission('company:create');
  return (
    // Its first Admin needs a recent confirmation (`grantNeedsConfirmation`): the form asks first.
    <RecentConfirmationProvider
      required={actor.canConfirmSessions}
      returnTo="/admin/companies/new"
      {...confirmationWindow(actor.mfaConfirmedUntil)}
    >
      <Card>
        <RegisterCompanyForm />
      </Card>
    </RecentConfirmationProvider>
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
      <PageHeader
        title="Add a company"
        description="Create a company and invite its first admin. They can invite their colleagues and start raising requests."
        back={{ href: '/admin/companies', label: 'Companies' }}
      />
      <Suspense fallback={<FormSkeleton />}>
        <Register />
      </Suspense>
    </div>
  );
}
