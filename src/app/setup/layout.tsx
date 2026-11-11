/**
 * @file Layout of the first-run setup page: the public layout.
 */
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';

import AuthLayout from '@/components/layout/auth-layout';
import notFoundMetadata from '@/lib/not-found-metadata';
import appContext from '@/server/app-context';
import { isWebSetupOpen } from '@/server/setup';

/**
 * Metadata: "Set up Adiutor", in the request's language and without the
 * title template (the product's name is in it already). A one-time page,
 * kept out of search engines. Once Adiutor is set up the page is the 404
 * page, so it gets the 404 page's title too.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  if (!(await isWebSetupOpen(appContext.db))) {
    return notFoundMetadata();
  }
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
