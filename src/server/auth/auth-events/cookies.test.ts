/**
 * @file Tests for expiring a cookie only in a browser that sent it.
 */
import { describe, expect, it, vi } from 'vitest';

import { expireCookieIfSent } from './cookies';
import type { AuthHookContext } from './hook-context';

vi.mock('@/lib/env', () => ({ secureCookies: false }));

/**
 * Builds the endpoint context of a request with a `Cookie` header.
 *
 * @param cookie - The header, or `null` for a request without one.
 * @returns The context, and what it set on the response.
 */
function requestWith(cookie: string | null): {
  ctx: AuthHookContext;
  setCookie: ReturnType<typeof vi.fn>;
} {
  const setCookie = vi.fn();
  return {
    ctx: { headers: new Headers(cookie === null ? {} : { cookie }), setCookie, context: {} },
    setCookie,
  };
}

describe('expireCookieIfSent', () => {
  it('expires a cookie the browser sent, on every path', () => {
    const { ctx, setCookie } = requestWith('adiutor.locale=nl-NL; adiutor.notice=github');

    expireCookieIfSent(ctx, 'adiutor.notice');

    expect(setCookie).toHaveBeenCalledExactlyOnceWith('adiutor.notice', '', {
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: false,
    });
  });

  it('tells a browser that didn’t send the cookie nothing', () => {
    const other = requestWith('adiutor.locale=nl-NL');
    const none = requestWith(null);

    expireCookieIfSent(other.ctx, 'adiutor.notice');
    expireCookieIfSent(none.ctx, 'adiutor.notice');

    expect(other.setCookie).not.toHaveBeenCalled();
    expect(none.setCookie).not.toHaveBeenCalled();
  });
});
