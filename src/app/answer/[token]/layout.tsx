/**
 * @file Layout of the page an email's Approve and Deny links end on: the
 * public layout.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import AuthLayout from '@/components/layout/auth-layout';
import secretLinkMetadata from '@/lib/secret-link-metadata';

/**
 * Metadata: "Your answer", in the request's language. The URL contains a
 * secret token, so it's never sent as a referrer and the page isn't indexed.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('requests.answerLink');
  return { ...secretLinkMetadata, title: t('title') };
}

/**
 * Shows the page in the public layout (form column and brand panel).
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page.
 * @returns The layout.
 */
export default function Layout({ children }: LayoutProps<'/answer/[token]'>) {
  return <AuthLayout>{children}</AuthLayout>;
}
