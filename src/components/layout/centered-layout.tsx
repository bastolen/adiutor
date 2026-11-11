/**
 * @file A calm, centered layout for standalone status pages such as the 404
 * page: the logo in the top-left corner and the content in the middle of the
 * page.
 */
import type { ReactNode } from 'react';

import Logo from '@/components/brand/logo';
import { focusRing } from '@/components/ui/styles';

import HomeLink from './home-link';
import PreferencesMenu from './preferences-menu';
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
 * shows it, and the content centered on the page. These pages have no account
 * menu, so the theme and language button is here, last in tab order: floating
 * in the corner from tablet width, and at the end of the page below that.
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
        <HomeLink className={`inline-flex w-fit rounded-md px-1.5 py-1 ${focusRing}`}>
          <Logo height={26} priority />
        </HomeLink>
      </header>
      <main
        id="main"
        tabIndex={-1}
        // From tablet width the space below keeps the content clear of the floating button.
        className="flex flex-1 items-center justify-center px-6 pt-8 pb-8 outline-none md:pb-24"
      >
        <div className="w-full max-w-md">{children}</div>
      </main>
      {/* Below tablet width at the end of the page; from there, in the corner. */}
      <PreferencesMenu className="mr-4 mb-4 self-end" />
    </div>
  );
}
