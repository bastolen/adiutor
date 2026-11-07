/**
 * @file The add-user page, served at `/admin/users/new`: registers an
 * account by email address, without companies or staff access. Staff Admins and
 * Managers only (`users:create`).
 */
import { Suspense } from 'react';

import Card from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import { FormSkeleton } from '@/components/ui/skeleton';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';

import RegisterUserForm from './register-user-form';

/**
 * Page metadata: "Add user · Adiutor" for those who may see the page (`users:create`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
export const generateMetadata = globalPermissionMetadata('users:create', {
  title: 'Add user · Adiutor',
});

/**
 * Checks the permission, then shows the form.
 *
 * @returns The form card.
 */
async function Register() {
  await requireGlobalPermission('users:create');
  return (
    <Card>
      <RegisterUserForm />
    </Card>
  );
}

/**
 * The add-user page.
 *
 * @returns The page.
 */
export default function NewUserPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Add a user"
        description="Create an account and email them a link to choose a password. Add them to companies or give them staff access afterwards, from their page."
        back={{ href: '/admin/users', label: 'Users' }}
      />
      <Suspense fallback={<FormSkeleton />}>
        <Register />
      </Suspense>
    </div>
  );
}
