/**
 * @file Page to choose a new password, served at `/auth/reset-password`.
 * Opened from the link in a password reset email.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FormSkeleton } from '@/components/ui/skeleton';
import secretLinkMetadata from '@/lib/secret-link-metadata';

import ResetPasswordForm from './reset-password-form';

/**
 * Page metadata. The address holds the reset token, so it isn't sent along
 * to other pages, and the page is kept out of search engines.
 */
export const metadata: Metadata = { ...secretLinkMetadata, title: 'Reset password' };

/**
 * The reset-password page. The form reads the token from the URL, so it
 * renders at request time behind a Suspense boundary.
 *
 * @returns The page.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
