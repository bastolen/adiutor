/**
 * @file Layout of the first-run setup page: the public layout.
 */
import type { Metadata } from 'next';

import AuthLayout from '@/components/layout/auth-layout';

/**
 * Metadata: a one-time page, kept out of search engines.
 */
export const metadata: Metadata = {
  title: 'Set up Adiutor',
  robots: { index: false, follow: false },
};

/**
 * Shows the page in the public layout (form column and brand panel).
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page.
 * @returns The layout.
 */
export default function SetupLayout({ children }: LayoutProps<'/setup'>) {
  return <AuthLayout>{children}</AuthLayout>;
}
