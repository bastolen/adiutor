/**
 * @file How a cookie that tells the next page something is set: by the
 * reactions to Better Auth's requests (`setNextPageCookie` in
 * `src/server/auth/auth-events/`) and by server actions
 * (`markActingAsChanged`). The page shows or acts on it and removes it in the
 * browser (`src/components/auth/use-next-page-cookie.ts`). Loaded by the
 * Better Auth config too, so it stays free of `server-only`.
 */
import { secureCookies } from '@/lib/env';

/** How long such a cookie lasts, in seconds: long enough for the next page to load. */
const NEXT_PAGE_COOKIE_SECONDS = 300;

/**
 * The settings of a cookie for the next page: for 5 minutes, on every path
 * (so signing out removes it), sent with navigations from other sites
 * (`lax`, e.g. back from GitHub), over HTTPS when the app uses it, and
 * readable in the browser (`httpOnly: false`), which removes it.
 *
 * @returns The cookie options, in the shape both Next.js and Better Auth take.
 */
export default function nextPageCookieOptions() {
  return {
    maxAge: NEXT_PAGE_COOKIE_SECONDS,
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: secureCookies,
  } as const;
}
