/**
 * @file Reading, setting and expiring the cookies the reactions use to tell the
 * next page something.
 */
import { secureCookies } from '@/lib/env';

import nextPageCookieOptions from '../next-page-cookie';
import type { AuthHookContext } from './hook-context';

/**
 * Checks whether the request sent a cookie.
 *
 * @param ctx - The endpoint context.
 * @param name - The cookie's name.
 * @returns Whether its `Cookie` header has it.
 */
export function sentCookie(ctx: AuthHookContext, name: string): boolean {
  return ctx.headers?.get('cookie')?.includes(`${name}=`) ?? false;
}

/**
 * Sets a cookie that tells the next page something, which shows it or acts
 * on it and removes it in the browser (`ProviderLinkedNotice`,
 * `ProviderStepUpNotice`, through `useNextPageCookie` in
 * `src/components/auth/use-next-page-cookie.ts`, and
 * `ReloadWhenActingAsChanges`), with {@link nextPageCookieOptions}: for 5
 * minutes, readable in the browser (not `httpOnly`), and on every path, so
 * signing out removes it.
 *
 * @param ctx - The endpoint context.
 * @param name - The cookie's name.
 * @param value - Its value.
 */
export function setNextPageCookie(ctx: AuthHookContext, name: string, value: string): void {
  ctx.setCookie?.(name, value, nextPageCookieOptions());
}

/**
 * Expires a cookie in the browser.
 *
 * @param ctx - The endpoint context, after the request.
 * @param name - The cookie's name.
 */
export function expireCookie(ctx: AuthHookContext, name: string): void {
  ctx.setCookie?.(name, '', {
    maxAge: 0,
    path: '/',
    sameSite: 'lax',
    // Cookies named `__Secure-` or `__Host-` can only be changed by a secure response.
    secure: secureCookies || /^__(Secure|Host)-/.test(name),
  });
}
