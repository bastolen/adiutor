/**
 * @file Tests for telling the browser's tabs, from a server action, that it
 * acts as someone else now: the action leaves the next page a cookie that
 * holds only `1`, for 5 minutes, on every path, readable in the browser,
 * and over HTTPS when the app uses it.
 */
import { describe, expect, it, vi } from 'vitest';

import { ACTING_AS_CHANGED_COOKIE } from '@/lib/sign-in/auth-cookies';

import markActingAsChanged from './acting-as-changed';

/** The mocked cookies of the response. */
const { cookieStore } = vi.hoisted(() => ({ cookieStore: { set: vi.fn() } }));

vi.mock('@/lib/env', () => ({ secureCookies: true }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

describe('markActingAsChanged', () => {
  it('leaves the next page the cookie, saying nothing about anyone', async () => {
    await markActingAsChanged();

    expect(cookieStore.set).toHaveBeenCalledExactlyOnceWith(ACTING_AS_CHANGED_COOKIE, '1', {
      maxAge: 300,
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      secure: true,
    });
  });
});
