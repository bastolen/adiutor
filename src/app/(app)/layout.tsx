/**
 * @file Layout of the signed-in app: skip link, navigation (sidebar or mobile
 * menu), the banner while a staff member is signed in as a user, the notices
 * after a provider sign-in, the page content, and the toasts that report what
 * the user's actions did.
 */
import { Suspense } from 'react';

import ProviderStepUpNotice from '@/components/auth/provider-step-up-notice';
import SkipLink from '@/components/layout/skip-link';
import { Toaster } from '@/components/ui/toast';

import Navigation from './navigation';
import ProviderLinkedNotice from './provider-linked-notice';
import SignedInAsBanner from './signed-in-as-banner';

/**
 * Renders the navigation and the page. The navigation reads the session, so
 * it streams in behind a Suspense boundary; its placeholder reserves the same
 * space so nothing jumps.
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page.
 * @returns The app layout.
 */
export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="min-h-dvh bg-background lg:pl-64">
      <SkipLink />
      <Suspense
        fallback={
          <>
            <div className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-surface lg:block" />
            <div className="h-14 border-b border-border bg-surface lg:hidden" />
          </>
        }
      >
        <Navigation />
      </Suspense>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 outline-none sm:px-6 lg:px-10 lg:py-10"
      >
        {/* First in the content, so it's what the skip link and a screen reader reach first. */}
        <Suspense fallback={null}>
          <SignedInAsBanner />
        </Suspense>
        {/* After "Confirm with GitHub" didn't count, also on the Security page's MFA setup. */}
        <ProviderStepUpNotice />
        <ProviderLinkedNotice />
        {children}
      </main>
      {/* Beside the content, not around it: the layout stays a server component. */}
      <Toaster />
    </div>
  );
}
