/**
 * @file Root layout: the HTML shell shared by every page.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getLocale, getMessages, getTimeZone, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { StaffNameProvider } from '@/components/brand/staff-name';
import { OfferedLanguagesProvider } from '@/components/language/offered-languages';
import fontVariables from '@/lib/fonts';
import IntlClientProvider from '@/lib/i18n/intl-client-provider';
import { pickMessages } from '@/lib/i18n/messages';
import { requestLanguageSettings } from '@/lib/i18n/request-locale';
import { NONCE_HEADER } from '@/lib/request/csp';
import { themeScript } from '@/lib/theme';
import { pageBrandCss, requestStaffName } from '@/server/branding';

import ReloadWhenActingAsChanges from './reload-when-acting-as-changes';

import './globals.css';

/**
 * Default page metadata, in the request's language. Pages set their own
 * title, which the template ends with the staff's name ("Users · Adiutor",
 * or "Users · Adiutor Support" once setup named the staff so; decision 0050).
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, staff] = await Promise.all([getTranslations('common'), requestStaffName()]);
  return {
    title: { template: t('documentTitle', { page: '%s', staff }), default: staff },
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
 * pages pass their own namespaces with `ClientMessages`. The languages
 * Adiutor offers come along too (`OfferedLanguagesProvider`), for the
 * language choices, and the staff's name (`StaffNameProvider`), which every
 * text shows instead of "Adiutor" (decision 0050).
 *
 * The inline theme script sets `data-theme` on `<html>` before the page
 * paints, so `suppressHydrationWarning` tells React that this attribute is
 * expected to differ from the server-rendered HTML. It carries the request's
 * nonce, or the Content Security Policy would block it.
 *
 * When a staff Admin chose brand colours, a `<style>` sets the palette worked
 * out from them over the theme's (decision 0049), for every page including
 * the signed-out and error pages. It holds only hex colours branding wrote
 * (`paletteCss`), and the policy allows inline styles.
 *
 * Every page loads afresh when another tab of this browser signs in or out,
 * or starts or ends a sign-in as a user (`ReloadWhenActingAsChanges`). It
 * reads the path, which isn't known while Next prerenders a route with
 * dynamic parameters, so it waits behind its own `<Suspense>` (rendering
 * nothing meanwhile).
 */
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const [nonce, locale, messages, timeZone, languages, brandCss, staffName] = await Promise.all([
    headers().then((list) => list.get(NONCE_HEADER) ?? undefined),
    getLocale(),
    getMessages(),
    getTimeZone(),
    requestLanguageSettings(),
    pageBrandCss(),
    requestStaffName(),
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
        {brandCss ? (
          // eslint-disable-next-line react/no-danger -- Hex colours and custom property names only, written and checked by paletteCss.
          <style dangerouslySetInnerHTML={{ __html: brandCss }} />
        ) : null}
      </head>
      <body className="bg-background text-foreground antialiased">
        <IntlClientProvider
          locale={locale}
          messages={pickMessages(messages, ['common'])}
          timeZone={timeZone}
        >
          <OfferedLanguagesProvider offered={languages.offered}>
            <StaffNameProvider name={staffName}>{children}</StaffNameProvider>
          </OfferedLanguagesProvider>
        </IntlClientProvider>
        <Suspense fallback={null}>
          <ReloadWhenActingAsChanges />
        </Suspense>
      </body>
    </html>
  );
}
