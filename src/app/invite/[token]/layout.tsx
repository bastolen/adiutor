/**
 * @file Layout of the public invite pages: the public layout.
 */
import type { Metadata } from 'next';

import AuthLayout from '@/components/layout/auth-layout';
import secretLinkMetadata from '@/lib/secret-link-metadata';

/**
 * Metadata: the URL contains a secret token, so it's never sent as a referrer
 * and the page isn't indexed.
 */
export const metadata: Metadata = { ...secretLinkMetadata, title: 'Invitation · Adiutor' };

/**
 * Shows the page in the public layout (form column and brand panel).
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page.
 * @returns The layout.
 */
export default function Layout({ children }: LayoutProps<'/invite/[token]'>) {
  return <AuthLayout>{children}</AuthLayout>;
}
