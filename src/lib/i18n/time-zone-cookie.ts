/**
 * @file How the time zone cookie (`TIME_ZONE_COOKIE`) is set: when someone
 * signs in, when their zone is saved, and on their first visit. Server only:
 * it reads the app's address.
 */
import { secureCookies } from '@/lib/env';

/** A year, in seconds: the cookie mirrors the account, which keeps its zone. */
const ONE_YEAR = 365 * 24 * 60 * 60;

/**
 * The time zone cookie's settings: on every path (so signing out reaches
 * it), for a year, sent with navigations from other sites (`lax`), over HTTPS
 * when the app uses it, and only for the server (`httpOnly`): the browser
 * knows its own zone. It holds nothing but a zone's name.
 *
 * @returns The cookie options, in the shape both Next.js and Better Auth take.
 */
export default function timeZoneCookieOptions() {
  return {
    maxAge: ONE_YEAR,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies,
  } as const;
}
