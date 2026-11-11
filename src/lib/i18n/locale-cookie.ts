/**
 * @file How the language cookie is set, by the language menus and at
 * sign-in (docs/i18n.md, "How the language is chosen"). Server only: it reads
 * the app's address.
 */
import { secureCookies } from '@/lib/env';

/** A year, in seconds: the language is a lasting preference of the browser. */
const ONE_YEAR = 365 * 24 * 60 * 60;

/**
 * The language cookie's settings: on every path, for a year, sent with
 * navigations from other sites (`lax`), over HTTPS when the app uses it, and
 * readable in the browser (`httpOnly: false`) for the last-resort error page.
 * It holds nothing but a locale.
 *
 * @returns The cookie options, in the shape both Next.js and Better Auth take.
 */
export default function localeCookieOptions() {
  return {
    maxAge: ONE_YEAR,
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: secureCookies,
  } as const;
}
