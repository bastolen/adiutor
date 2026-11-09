/**
 * @file Tests for which cookies a sign-out removes: all the browser sent,
 * except the "Last used" sign-in method and the language.
 */
import { describe, expect, it } from 'vitest';

import { cookiesToClearAtSignOut, LAST_USED_LOGIN_METHOD_COOKIE } from './auth-cookies';

describe('cookiesToClearAtSignOut', () => {
  it('lists every cookie but the last sign-in method and the language, each once', () => {
    const header = [
      'better-auth.session_token=abc.def',
      '__Secure-better-auth.trust_device=xyz',
      `${LAST_USED_LOGIN_METHOD_COOKIE}=github`,
      'adiutor.locale=nl-NL',
      'adiutor-provider-linked=github%3Aadiutor-tests',
      'better-auth.session_token=again',
      'empty=',
    ].join('; ');

    expect(cookiesToClearAtSignOut(header)).toEqual([
      'better-auth.session_token',
      '__Secure-better-auth.trust_device',
      'adiutor-provider-linked',
      'empty',
    ]);
  });

  it('has nothing to clear without cookies', () => {
    expect(cookiesToClearAtSignOut(null)).toEqual([]);
    expect(cookiesToClearAtSignOut(undefined)).toEqual([]);
    expect(cookiesToClearAtSignOut('')).toEqual([]);
    expect(cookiesToClearAtSignOut(`${LAST_USED_LOGIN_METHOD_COOKIE}=email`)).toEqual([]);
    expect(cookiesToClearAtSignOut(' ; ;')).toEqual([]);
  });

  it('names the last sign-in method cookie after the app', () => {
    expect(LAST_USED_LOGIN_METHOD_COOKIE).toBe('adiutor.last_used_login_method');
  });

  it("clears Better Auth's default name for it, which nothing reads any more", () => {
    expect(cookiesToClearAtSignOut('better-auth.last_used_login_method=github')).toEqual([
      'better-auth.last_used_login_method',
    ]);
  });
});
