/**
 * @file The last-resort error page, for errors in the root layout itself.
 * It replaces the whole document, so it brings its own `<html>`, `<body>`,
 * `<title>`, the global styles and the shared messages, and shows the root
 * error page in them.
 *
 * The root layout's inline theme script isn't there (and the Content
 * Security Policy wouldn't let an inline script without the request's nonce
 * run), so the saved light or dark theme is applied in an effect instead.
 * Nor is the request's language: the page renders in English (US), as the
 * server can't tell, then switches after mount to the language cookie's, or
 * else the browser's, so hydration matches (docs/i18n.md).
 */
'use client';

import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { useEffect, useSyncExternalStore } from 'react';

import fontVariables from '@/lib/fonts';
import {
  DEFAULT_LOCALE,
  isLocale,
  languageCookieValue,
  type Locale,
  localeForLanguages,
} from '@/lib/i18n/locales';
import { onMessageError } from '@/lib/i18n/message-errors';
import { TIME_ZONE } from '@/lib/i18n/time-zone';
import { DARK_MEDIA_QUERY, isThemePreference, resolveTheme, THEME_STORAGE_KEY } from '@/lib/theme';
import enUsCommon from '@/messages/en-US/common.json';
import esEsCommon from '@/messages/es-ES/common.json';
import nlNlCommon from '@/messages/nl-NL/common.json';

import RootError, { type ErrorPageProps } from './error';

import './globals.css';

/**
 * The shared messages in every language, bundled with this page alone: it
 * can't ask the server for them.
 */
const COMMON_MESSAGES: Record<Locale, typeof enUsCommon> = {
  'en-US': enUsCommon,
  'nl-NL': nlNlCommon,
  'es-ES': esEsCommon,
};

/**
 * Shows the saved theme, as the root layout's inline script would have.
 */
function applySavedTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    document.documentElement.dataset.theme = resolveTheme(
      isThemePreference(stored) ? stored : 'system',
      window.matchMedia(DARK_MEDIA_QUERY).matches,
    );
  } catch {
    // Storage can be blocked (e.g. some private modes); the CSS then follows the system.
  }
}

/**
 * The browser's language: its choice in the language cookie, else the first
 * of the languages it's set to that we speak, as the server would choose.
 *
 * @returns The locale, or the default when neither gives one.
 */
function savedLocale(): Locale {
  const value = languageCookieValue(document.cookie);
  if (isLocale(value)) {
    return value;
  }
  return localeForLanguages(navigator.languages) ?? DEFAULT_LOCALE;
}

/**
 * Subscribes to changes of the language cookie, which don't happen while
 * this page is shown.
 *
 * @returns A function that unsubscribes.
 */
function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * The language on the server, which can't read the cookie here.
 *
 * @returns The default locale.
 */
function serverLocale(): Locale {
  return DEFAULT_LOCALE;
}

/**
 * The document's title, inside the provider.
 *
 * @returns The `<title>` element.
 */
function ErrorTitle() {
  const t = useTranslations('common');
  return <title>{t('documentTitle', { page: t('error.title') })}</title>;
}

/**
 * The document with the root error page in it.
 *
 * @param props - Props from Next.js.
 * @param props.error - What was thrown.
 * @param props.retry - Fetches and renders the page again.
 * @returns The error document.
 */
export default function GlobalError({ error, retry }: ErrorPageProps) {
  // English while hydrating (what the server rendered), then the cookie's language.
  const locale = useSyncExternalStore(subscribeToNothing, savedLocale, serverLocale);

  useEffect(() => {
    applySavedTheme();
  }, []);

  return (
    <html lang={locale} className={fontVariables}>
      <body className="bg-background text-foreground antialiased">
        <NextIntlClientProvider
          locale={locale}
          messages={COMMON_MESSAGES[locale]}
          timeZone={TIME_ZONE}
          onError={onMessageError}
        >
          <ErrorTitle />
          <RootError error={error} retry={retry} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
