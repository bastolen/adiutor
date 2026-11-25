/**
 * @file First-run setup, served at `/setup` (public). Names the staff and
 * makes the person filling it in its Admin; until then, whoever reaches the
 * site first can do this. It only exists on a fresh install: once set up, or
 * once any account exists, it's a 404 (`isWebSetupOpen`).
 */
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import AuthHeading from '@/components/ui/auth-heading';
import { FormSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { isWebSetupOpen } from '@/server/setup';

import SetupForm from './setup-form';

/**
 * Shows the setup form on a fresh install, or the 404 page.
 */
async function Setup() {
  await connection();
  if (!(await isWebSetupOpen(appContext.db))) {
    notFound();
  }
  const t = await getTranslations('auth');

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title={t('setup.heading')} description={t('setup.description')} />
      <SetupForm />
    </div>
  );
}

/**
 * The setup page. The form's text comes with it (`auth`).
 */
export default function SetupPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ClientMessages namespaces={['auth']}>
        <Setup />
      </ClientMessages>
    </Suspense>
  );
}
