/**
 * @file Root layout: the HTML shell shared by every page.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import fontVariables from '@/lib/fonts';
import IntlClientProvider from '@/lib/i18n/intl-client-provider';
import { pickMessages } from '@/lib/i18n/messages';
import { NONCE_HEADER } from '@/lib/request/csp';
import { themeScript } from '@/lib/theme';

import ReloadWhenActingAsChanges from './reload-when-acting-as-changes';

import './globals.css';

/**
 * Default page metadata, in the request's language. Pages set their own
 * title, which the template ends with the product name ("Users · Adiutor").
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return {
    title: { template: t('documentTitle', { page: '%s' }), default: 'Adiutor' },
    description: t('app.description'),
  };
}

/**
 * The layout reads the request's CSP nonce (see `src/lib/request/csp.ts`), so every
 * page renders per request and the static shell is empty. This turns off
 * Cache Components' empty-shell validation for the app (navigations below the
 * root are still validated); it doesn't make anything dynamic by itself.
 */
export const instant = false;

/**
 * Wraps every page in the `<html>` and `<body>` elements and loads the global
 * styles and the fonts Adiutor ships (`src/lib/fonts.ts`). The theme choice is in the layouts below: the floating button in
 * the public layout, the account menu in the app.
 *
 * `<html lang>` is the request's language (docs/i18n.md), and the shared
 * `common` messages reach every client component through the provider;
 * pages pass their own namespaces with `ClientMessages`.
 *
 * The inline theme script sets `data-theme` on `<html>` before the page
 * paints, so `suppressHydrationWarning` tells React that this attribute is
 * expected to differ from the server-rendered HTML. It carries the request's
 * nonce, or the Content Security Policy would block it.
 *
 * Every page loads afresh when another tab of this browser signs in or out,
 * or starts or ends a sign-in as a user (`ReloadWhenActingAsChanges`). It
 * reads the path, which isn't known while Next prerenders a route with
 * dynamic parameters, so it waits behind its own `<Suspense>` (rendering
 * nothing meanwhile).
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page or nested layout to render.
 * @returns The document shell.
 */
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const [nonce, locale, messages] = await Promise.all([
    headers().then((list) => list.get(NONCE_HEADER) ?? undefined),
    getLocale(),
    getMessages(),
  ]);
  return (
    <html
      lang={locale}
      className={fontVariables}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/* eslint-disable-next-line react/no-danger -- Static script from our own code; it must run before the first paint. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <IntlClientProvider locale={locale} messages={pickMessages(messages, ['common'])}>
          {children}
        </IntlClientProvider>
        <Suspense fallback={null}>
          <ReloadWhenActingAsChanges />
        </Suspense>
      </body>
    </html>
  );
}
