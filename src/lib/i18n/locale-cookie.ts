/**
 * @file How the language cookie is set, by the language menus and at
 * sign-in (docs/i18n.md, "How the language is chosen"). Server only: it reads
 * the app's address.
 */
import preferenceCookieOptions from './preference-cookie';

/**
 * The language cookie's settings: a preference cookie's
 * (`preferenceCookieOptions`: every path, a year, `lax`, HTTPS when the app
 * uses it), readable in the browser (`httpOnly: false`) for the last-resort
 * error page. It holds nothing but a locale.
 *
 * @returns The cookie options, in the shape both Next.js and Better Auth take.
 */
export default function localeCookieOptions() {
  return preferenceCookieOptions(false);
}
