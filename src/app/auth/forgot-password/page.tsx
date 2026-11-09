/**
 * @file Page to request a password reset link, served at
 * `/auth/forgot-password`.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { FormSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';

import ForgotPasswordForm from './forgot-password-form';

/**
 * Page metadata: "Forgot password", in the request's language.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('forgotPassword.title') };
}

/**
 * The forgot-password page. The form's text is in the request's language
 * (`auth`), so it renders behind a Suspense boundary.
 *
 * @returns The page.
 */
export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ClientMessages namespaces={['auth']}>
        <ForgotPasswordForm />
      </ClientMessages>
    </Suspense>
  );
}
