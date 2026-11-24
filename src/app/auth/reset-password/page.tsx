/**
 * @file Page to choose a new password, served at `/auth/reset-password`.
 * Opened from the link in a password reset email.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { FormSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import secretLinkMetadata from '@/lib/secret-link-metadata';

import ResetPasswordForm from './reset-password-form';

/**
 * Page metadata: "Reset password", in the request's language. The address
 * holds the reset token, so it isn't sent along to other pages, and the page
 * is kept out of search engines.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { ...secretLinkMetadata, title: t('resetPassword.title') };
}

/**
 * The reset-password page. The form reads the token from the URL, so it
 * renders at request time behind a Suspense boundary, with its text (`auth`).
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ClientMessages namespaces={['auth']}>
        <ResetPasswordForm />
      </ClientMessages>
    </Suspense>
  );
}
