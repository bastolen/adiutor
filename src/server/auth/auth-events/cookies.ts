/**
 * @file Reading, setting and expiring the cookies the reactions use to tell the
 * next page something.
 */
import { appUrl } from '@/lib/env';

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
 * Sets a cookie that tells the next page something, which shows it and
 * removes it in the browser (`ProviderLinkedNotice`, `ProviderStepUpNotice`,
 * through `useNextPageCookie` in `src/components/auth/use-next-page-cookie.ts`):
 * for 5 minutes, readable in the browser (not `httpOnly`), and on every path,
 * so signing out removes it.
 *
 * @param ctx - The endpoint context.
 * @param name - The cookie's name.
 * @param value - Its value.
 */
export function setNextPageCookie(ctx: AuthHookContext, name: string, value: string): void {
  ctx.setCookie?.(name, value, {
    maxAge: 300,
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: appUrl.startsWith('https://'),
  });
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
    secure: appUrl.startsWith('https://') || /^__(Secure|Host)-/.test(name),
  });
}
