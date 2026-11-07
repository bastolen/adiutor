/**
 * @file A calm, centered layout for standalone status pages such as the 404
 * page: the logo in the top-left corner and the content in the middle of the
 * page.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

import Logo from '@/components/brand/logo';
import ThemeSwitcher from '@/components/theme/theme-switcher';
import { focusRing } from '@/components/ui/styles';

import SkipLink from './skip-link';

/**
 * Props for {@link CenteredLayout}.
 */
interface CenteredLayoutProps {
  /** The page content, centered in a narrow column. */
  children: ReactNode;
}

/**
 * The logo in the top-left corner (linking home), where the app's sidebar
 * shows it, and the content centered on the page. These pages have no account menu, so the floating theme
 * button is here, last in tab order.
 *
 * @param props - Layout props.
 * @param props.children - The page content.
 * @returns The layout.
 */
export default function CenteredLayout({ children }: CenteredLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SkipLink />
      {/* Same spacing and size as the logo in the app's sidebar, so it stays put between them. */}
      <header className="p-4">
        <Link
          href="/"
          aria-label="Adiutor home"
          className={`inline-flex w-fit rounded-md px-1.5 py-1 ${focusRing}`}
        >
          <Logo height={26} priority />
        </Link>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-6 pt-8 pb-24 outline-none"
      >
        <div className="w-full max-w-md">{children}</div>
      </main>
      <ThemeSwitcher />
    </div>
  );
}
