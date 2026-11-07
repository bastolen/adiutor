/**
 * @file The last-resort error page, for errors in the root layout itself.
 * It replaces the whole document, so it brings its own `<html>`, `<body>`,
 * `<title>` and the global styles, and shows the root error page in them.
 *
 * The root layout's inline theme script isn't there (and the Content
 * Security Policy wouldn't let an inline script without the request's nonce
 * run), so the saved light or dark theme is applied in an effect instead.
 */
'use client';

import { useEffect } from 'react';

import { DARK_MEDIA_QUERY, isThemePreference, resolveTheme, THEME_STORAGE_KEY } from '@/lib/theme';

import RootError, { type ErrorPageProps } from './error';

import './globals.css';

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
 * The document with the root error page in it.
 *
 * @param props - Props from Next.js.
 * @param props.error - What was thrown.
 * @param props.retry - Fetches and renders the page again.
 * @returns The error document.
 */
export default function GlobalError({ error, retry }: ErrorPageProps) {
  useEffect(() => {
    applySavedTheme();
  }, []);

  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <title>Something went wrong · Adiutor</title>
        <RootError error={error} retry={retry} />
      </body>
    </html>
  );
}
