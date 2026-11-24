/**
 * @file The settings of the cookies that mirror a lasting preference of the
 * browser's person: the language (`locale-cookie.ts`) and the time zone
 * (`time-zone-cookie.ts`). Server only: it reads the app's address.
 */
import { secureCookies } from '@/lib/env';

/** A year, in seconds: the cookie mirrors a preference that lasts. */
const ONE_YEAR = 365 * 24 * 60 * 60;

/**
 * A preference cookie's settings: on every path (so signing out reaches it),
 * for a year, sent with navigations from other sites (`lax`) and over HTTPS
 * when the app uses it. Such a cookie holds nothing but the preference.
 *
 * @param httpOnly - Whether only the server reads it.
 * @returns The cookie options, in the shape both Next.js and Better Auth take.
 */
export default function preferenceCookieOptions<HttpOnly extends boolean>(httpOnly: HttpOnly) {
  return {
    maxAge: ONE_YEAR,
    path: '/',
    httpOnly,
    sameSite: 'lax',
    secure: secureCookies,
  } as const;
}
