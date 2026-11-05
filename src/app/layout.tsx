/**
 * @file Root layout: the HTML shell shared by every page.
 */
import type { Metadata } from 'next';

import ThemeSwitcher from '@/components/theme/theme-switcher';
import { themeScript } from '@/lib/theme';

import './globals.css';

/**
 * Default page metadata. Pages can override these values.
 */
export const metadata: Metadata = {
  title: 'Adiutor',
};

/**
 * Wraps every page in the `<html>` and `<body>` elements, loads the global
 * styles, and adds the theme switcher.
 *
 * The inline theme script sets `data-theme` on `<html>` before the page
 * paints, so `suppressHydrationWarning` tells React that this attribute is
 * expected to differ from the server-rendered HTML.
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page or nested layout to render.
 * @returns The document shell.
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line react/no-danger -- Static script from our own code; it must run before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
        <ThemeSwitcher />
      </body>
    </html>
  );
}
