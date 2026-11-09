/**
 * @file The second sign-in step, served at `/auth/two-factor`: after a
 * correct password, the user enters a code from their authenticator app, an
 * emailed code, or a backup code.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { FormSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';

import TwoFactorForm from './two-factor-form';

/**
 * Page metadata: "Confirm it’s you", in the request's language.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('twoFactor.title') };
}

/**
 * The code step page. The form's text comes with it (`auth`).
 *
 * @returns The page.
 */
export default function TwoFactorPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ClientMessages namespaces={['auth']}>
        <TwoFactorForm />
      </ClientMessages>
    </Suspense>
  );
}
