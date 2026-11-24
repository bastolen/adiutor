/**
 * @file Layout of the public pages (sign-in, password reset, invitations,
 * invite links, setup): the form on the left and, on large screens, a brand
 * panel on the right that shows what Adiutor is for.
 */
import type { ReactNode } from 'react';

import Logo from '@/components/brand/logo';
import { focusRing } from '@/components/ui/styles';

import BrandPanel from './brand-panel';
import HomeLink from './home-link';
import PreferencesMenu from './preferences-menu';
import SkipLink from './skip-link';

/**
 * Props for {@link AuthLayout}.
 */
interface AuthLayoutProps {
  /** The page content (usually a form). */
  children: ReactNode;
}

/**
 * Two columns on large screens: the content in a narrow, centred column, and
 * a decorative brand panel with an example request and the product pitch,
 * written for companies (`BrandPanel`). On small screens, only the content
 * column. These pages have no account menu, so the theme and language button
 * is here, last in tab order: floating in the corner from tablet width, and at
 * the end of the content column below that.
 *
 * The layout is in each page's static shell, so its text comes from client
 * components that read the root provider (`HomeLink`, `BrandPanel`), never
 * from the request (docs/i18n.md).
 */
export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <SkipLink />
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <header>
          <HomeLink className={`inline-flex rounded-md ${focusRing}`}>
            <Logo height={32} priority />
          </HomeLink>
        </header>
        <main id="main" className="flex flex-1 items-center justify-center py-12 outline-none">
          <div className="w-full max-w-sm">{children}</div>
        </main>
        {/* Below tablet width at the end of the form column; from there, in the corner. */}
        <PreferencesMenu className="self-end" />
      </div>

      <BrandPanel />
    </div>
  );
}
