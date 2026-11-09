/**
 * @file Page to request a password reset link, served at
 * `/auth/forgot-password`.
 */
import type { Metadata } from 'next';

import ForgotPasswordForm from './forgot-password-form';

/**
 * Page metadata.
 */
export const metadata: Metadata = {
  title: 'Forgot password',
};

/**
 * The forgot-password page.
 *
 * @returns The page.
 */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
