/**
 * @file How the time zone cookie (`TIME_ZONE_COOKIE`) is set: when someone
 * signs in, when their zone is saved, and on their first visit. Server only:
 * it reads the app's address.
 */
import preferenceCookieOptions from './preference-cookie';

/**
 * The time zone cookie's settings: a preference cookie's
 * (`preferenceCookieOptions`: every path, a year, `lax`, HTTPS when the app
 * uses it), and only for the server (`httpOnly`): the browser knows its own
 * zone. It holds nothing but a zone's name.
 *
 * @returns The cookie options, in the shape both Next.js and Better Auth take.
 */
export default function timeZoneCookieOptions() {
  return preferenceCookieOptions(true);
}
