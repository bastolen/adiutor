/**
 * @file Layout of the public pages (sign-in, password reset, invitations,
 * invite links, setup): the form on the left and, on large screens, a brand
 * panel on the right that shows what Adiutor is for.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

import Logo from '@/components/brand/logo';
import ThemeSwitcher from '@/components/theme/theme-switcher';
import { focusRing } from '@/components/ui/styles';

import RequestPreview from './request-preview';
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
 * written for company users. On small screens, only the content column.
 * These pages have no account menu, so the floating theme button is here,
 * last in tab order.
 *
 * @param props - Layout props.
 * @param props.children - The page content.
 * @returns The layout.
 */
export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <SkipLink />
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <header>
          <Link
            href="/"
            aria-label="Adiutor home"
            className={`inline-flex rounded-md ${focusRing}`}
          >
            <Logo height={32} priority />
          </Link>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="flex flex-1 items-center justify-center py-12 outline-none"
        >
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>

      <div
        aria-hidden="true"
        className="relative hidden overflow-hidden bg-ink lg:flex lg:flex-col lg:justify-between lg:p-12"
      >
        <div className="absolute -top-40 -right-40 size-[36rem] rounded-full bg-brand-green/20 blur-3xl" />
        <div className="absolute -bottom-48 -left-32 size-[32rem] rounded-full bg-brand-teal/50 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        {/* Spacer as tall as the logo row on the left, so the example request stays centred. */}
        <div className="h-8" />
        <RequestPreview />
        <div className="relative flex max-w-md flex-col gap-4">
          <p className="text-3xl font-semibold tracking-tight text-white">
            Get help without chasing emails.
          </p>
          <p className="text-base text-white/75">
            Report a problem or ask for something new, follow its progress, and approve the work,
            all in one place.
          </p>
        </div>
      </div>
      <ThemeSwitcher />
    </div>
  );
}
