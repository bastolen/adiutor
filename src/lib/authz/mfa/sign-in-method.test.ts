/**
 * @file Tests for working out how a session's sign-in and second step happened
 * from the endpoint that created it.
 */
import { describe, expect, it } from 'vitest';

import { mfaMethodFromPath } from './session';
import { signInMethodFromPath } from './sign-in-method';

describe('sign-in paths', () => {
  it('knows which sign-ins had a second factor, and which', () => {
    expect(mfaMethodFromPath('/two-factor/verify-totp')).toBe('authenticator');
    expect(mfaMethodFromPath('/two-factor/verify-otp')).toBe('email_code');
    expect(mfaMethodFromPath('/two-factor/verify-backup-code')).toBe('backup_code');
    expect(mfaMethodFromPath('/passkey/verify-authentication')).toBe('passkey');
    expect(mfaMethodFromPath('/sign-in/email')).toBeNull();
    expect(mfaMethodFromPath('/magic-link/verify')).toBeNull();
    expect(mfaMethodFromPath('/request-link/sign-in')).toBeNull();
    expect(mfaMethodFromPath(undefined)).toBeNull();
  });

  it('finds no second factor for a name every object inherits', () => {
    ['constructor', 'toString', '__proto__', 'hasOwnProperty'].forEach((path) => {
      expect(mfaMethodFromPath(path)).toBeNull();
    });
  });

  it('names the sign-in method', () => {
    expect(signInMethodFromPath('/sign-in/email')).toBe('password');
    expect(signInMethodFromPath('/two-factor/verify-totp')).toBe('password_and_authenticator');
    expect(signInMethodFromPath('/two-factor/verify-otp')).toBe('password_and_email_code');
    expect(signInMethodFromPath('/two-factor/verify-backup-code')).toBe('backup_code');
    expect(signInMethodFromPath('/passkey/verify-authentication')).toBe('passkey');
    expect(signInMethodFromPath('/callback/:id', { providerId: 'github' })).toBe('github');
    expect(signInMethodFromPath('/callback/:id', { providerId: 'google' })).toBe('google');
    expect(signInMethodFromPath('/callback/:id', { providerId: 'unknown' })).toBe('other');
    expect(signInMethodFromPath('/magic-link/verify')).toBe('email_link');
    expect(signInMethodFromPath('/request-link/sign-in')).toBe('request_link');
    expect(signInMethodFromPath('/two-factor/enable')).toBeNull();
    expect(signInMethodFromPath(undefined)).toBeNull();
  });

  it("doesn't call a code checked with a session a sign-in", () => {
    // Turning on two-step verification (or confirming the session) replaces or keeps the session.
    expect(signInMethodFromPath('/two-factor/verify-totp', { signedIn: true })).toBeNull();
    expect(signInMethodFromPath('/two-factor/verify-otp', { signedIn: true })).toBeNull();
    expect(signInMethodFromPath('/two-factor/verify-backup-code', { signedIn: true })).toBeNull();
    // So does confirming it with a passkey on the step-up page; without a session it signs in.
    expect(signInMethodFromPath('/passkey/verify-authentication', { signedIn: true })).toBeNull();
    expect(signInMethodFromPath('/passkey/verify-authentication', { signedIn: false })).toBe(
      'passkey',
    );
    // Without one, the code finished a password sign-in.
    expect(signInMethodFromPath('/two-factor/verify-otp', { signedIn: false })).toBe(
      'password_and_email_code',
    );
  });

  it('names other sign-ins whether or not the browser had a session', () => {
    // Signing in again on a browser that's signed in is a sign-in.
    expect(signInMethodFromPath('/callback/:id', { providerId: 'github', signedIn: true })).toBe(
      'github',
    );
    expect(signInMethodFromPath('/magic-link/verify', { signedIn: true })).toBe('email_link');
    expect(signInMethodFromPath('/sign-in/email', { signedIn: true })).toBe('password');
  });

  it("doesn't call confirming a session with GitHub's 2FA a sign-in", () => {
    // "Confirm with GitHub" on the step-up page, which GitHub confirmed with the account's 2FA.
    expect(
      signInMethodFromPath('/callback/:id', {
        providerId: 'github',
        signedIn: true,
        providerMfa: true,
      }),
    ).toBeNull();
    // Without a session, it signed someone in, whether or not GitHub confirmed it.
    expect(
      signInMethodFromPath('/callback/:id', {
        providerId: 'github',
        signedIn: false,
        providerMfa: true,
      }),
    ).toBe('github');
    // Google can't prove MFA, so it never confirms a session.
    expect(
      signInMethodFromPath('/callback/:id', {
        providerId: 'google',
        signedIn: true,
        providerMfa: true,
      }),
    ).toBe('google');
    // Only provider callbacks: the option means nothing for other sign-ins.
    expect(signInMethodFromPath('/magic-link/verify', { signedIn: true, providerMfa: true })).toBe(
      'email_link',
    );
  });
});
