/**
 * @file Root layout: the HTML shell shared by every page.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { NONCE_HEADER } from '@/lib/request/csp';
import { themeScript } from '@/lib/theme';

import './globals.css';

/**
 * Default page metadata. Pages can override these values.
 */
export const metadata: Metadata = {
  title: 'Adiutor',
  description:
    'Get help without chasing emails. Report a problem or ask for something new, follow its progress, and approve the work, all in one place.',
};

/**
 * The layout reads the request's CSP nonce (see `src/lib/request/csp.ts`), so every
 * page renders per request and the static shell is empty. This turns off
 * Cache Components' empty-shell validation for the app (navigations below the
 * root are still validated); it doesn't make anything dynamic by itself.
 */
export const instant = false;

/**
 * Wraps every page in the `<html>` and `<body>` elements and loads the global
 * styles. The theme choice is in the layouts below: the floating button in
 * the public layout, the account menu in the app.
 *
 * The inline theme script sets `data-theme` on `<html>` before the page
 * paints, so `suppressHydrationWarning` tells React that this attribute is
 * expected to differ from the server-rendered HTML. It carries the request's
 * nonce, or the Content Security Policy would block it.
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page or nested layout to render.
 * @returns The document shell.
 */
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line react/no-danger -- Static script from our own code; it must run before the first paint. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
