/**
 * @file Layout of the first-run setup page: the public layout.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import AuthLayout from '@/components/layout/auth-layout';

/**
 * Metadata: "Set up Adiutor", in the request's language and without the
 * title template (the product's name is in it already). A one-time page,
 * kept out of search engines.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return {
    title: { absolute: t('setup.title') },
    robots: { index: false, follow: false },
  };
}

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
