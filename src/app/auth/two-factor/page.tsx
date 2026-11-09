/**
 * @file The second sign-in step, served at `/auth/two-factor`: after a
 * correct password, the user enters a code from their authenticator app, an
 * emailed code, or a backup code.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FormSkeleton } from '@/components/ui/skeleton';

import TwoFactorForm from './two-factor-form';

/**
 * Page metadata.
 */
export const metadata: Metadata = {
  title: 'Confirm it’s you',
};

/**
 * The code step page.
 *
 * @returns The page.
 */
export default function TwoFactorPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <TwoFactorForm />
    </Suspense>
  );
}
