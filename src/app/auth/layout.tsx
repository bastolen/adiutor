/**
 * @file Layout shared by the sign-in and password pages.
 */
import AuthLayout from '@/components/layout/auth-layout';

/**
 * Shows the page in the public layout (form column and brand panel).
 *
 * @returns The auth layout.
 */
export default function AuthPagesLayout({ children }: LayoutProps<'/auth'>) {
  return <AuthLayout>{children}</AuthLayout>;
}
