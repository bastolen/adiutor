/**
 * @file Proxy (formerly middleware): every page requires a signed-in user,
 * except the public ones in `PUBLIC_PATHS` (sign-in, invitations, invite links,
 * first-run setup, the links in emails that answer a solution, the health
 * check and the jobs' tick).
 *
 * Signed-out visitors are sent to the sign-in page (API routes get a 401).
 * This only checks that a session cookie exists, which is fast but not secure
 * on its own: pages and server actions still verify the session on the server
 * through `src/server/authz.ts`.
 *
 * New pages are protected automatically. Add a path here only if it must be
 * reachable without signing in.
 *
 * It also sets the Content Security Policy, with a fresh nonce per request
 * (`src/lib/request/csp.ts`), on every response it handles.
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/proxy
 */
import { getSessionCookie } from 'better-auth/cookies';
import { type NextRequest, NextResponse } from 'next/server';

import { contentSecurityPolicy, createNonce, NONCE_HEADER } from '@/lib/request/csp';
import PATHNAME_HEADER from '@/lib/request/pathname-header';

/**
 * Path prefixes reachable without signing in. `/api/health` is for load
 * balancers and monitors, and says only whether the app is up. `/api/jobs`
 * is the background jobs' tick, for a cron service: it checks its own secret
 * (`answerTickRequest`), since the proxy is never the security check.
 * `/answer` holds the links in an email that answer a proposed solution
 * (decision 0033): each works only with its secret token, for its person.
 */
const PUBLIC_PATHS = [
  '/answer',
  '/auth',
  '/invite',
  '/join',
  '/setup',
  '/sign-in-error',
  '/api/auth',
  '/api/health',
  '/api/jobs',
] as const;

/**
 * Checks whether a path is public: one of {@link PUBLIC_PATHS} or below it.
 *
 * @param pathname - The request path.
 * @returns Whether it can be visited signed out.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Lets public paths and signed-in visitors through; sends everyone else to
 * sign in, remembering the page so they return to it afterwards.
 *
 * @param request - The incoming request.
 * @returns A pass-through, a redirect to sign-in, or a 401 for API routes.
 */
export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce);
  /**
   * Adds the policy to a response.
   *
   * @returns The same response.
   */
  const withPolicy = (response: NextResponse) => {
    response.headers.set('Content-Security-Policy', policy);
    return response;
  };

  if (isPublicPath(pathname) || getSessionCookie(request)) {
    const requestHeaders = new Headers(request.headers);
    // Pages can't read their own URL on the server; pass it on, so the MFA
    // step-up can send the user back where they were.
    requestHeaders.set(PATHNAME_HEADER, `${pathname}${search}`);
    // Next.js reads the nonce from the policy in the request; the root layout from NONCE_HEADER.
    requestHeaders.set('Content-Security-Policy', policy);
    requestHeaders.set(NONCE_HEADER, nonce);
    return withPolicy(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  if (pathname.startsWith('/api/')) {
    return withPolicy(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const signInUrl = new URL('/auth', request.url);
  if (pathname !== '/') {
    signInUrl.searchParams.set('callbackURL', `${pathname}${search}`);
  }
  return withPolicy(NextResponse.redirect(signInUrl));
}

/**
 * Runs on every request except Next.js's own files and the static files in
 * `public/brand/` and the app icons, `/icon.svg` and `/favicon.ico` (those
 * get a fixed policy from `next.config.ts`). The icons must answer a
 * signed-out visitor, and a tool that asks for `/favicon.ico` without
 * reading the page, with the icon and not with the way to sign in. Paths
 * aren't skipped by their extension: a page URL like `/companies/x.png`
 * still renders the app and must get the policy.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|icon\\.svg|favicon\\.ico|brand/).*)'],
};
