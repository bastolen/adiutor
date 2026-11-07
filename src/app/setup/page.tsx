/**
 * @file First-run setup, served at `/setup` (public). Names the staff and
 * makes the person filling it in its Admin; until then, whoever reaches the
 * site first can do this. It only exists on a fresh install: once set up, or
 * once any account exists, it's a 404 (`isWebSetupOpen`).
 */
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import AuthHeading from '@/components/ui/auth-heading';
import { FormSkeleton } from '@/components/ui/skeleton';
import appContext from '@/server/app-context';
import { isWebSetupOpen } from '@/server/setup';

import SetupForm from './setup-form';

/**
 * Shows the setup form on a fresh install, or the 404 page.
 *
 * @returns The page content.
 */
async function Setup() {
  await connection();
  if (!(await isWebSetupOpen(appContext.db))) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title="Set up Adiutor"
        description="Choose the name users see and create your Admin account. From there you add companies and invite the people you work with. This page works only once."
      />
      <SetupForm />
    </div>
  );
}

/**
 * The setup page.
 *
 * @returns The page.
 */
export default function SetupPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <Setup />
    </Suspense>
  );
}
