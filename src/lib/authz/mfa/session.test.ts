/**
 * @file Tests for whether a session counts as having had a second factor, and
 * the window after a second step.
 */
import { describe, expect, it } from 'vitest';

import { MFA_PROVIDERS } from '../../sign-in/oauth-providers';
import {
  isMfaConfirmedRecently,
  isSessionMfaVerified,
  mfaConfirmedUntil,
  RECENT_MFA_MS,
  sessionMfaOf,
  signedInAtOf,
} from './session';
import type { MfaState } from './state';
import {
  authenticatorApp,
  bare,
  emailCodes,
  githubOnly,
  REQUIRED_ROLES,
  OPTIONAL_ROLES,
} from './test-helpers';

describe('isSessionMfaVerified', () => {
  it('needs a second factor', () => {
    expect(isSessionMfaVerified({ mfaVerified: false, mfaMethod: null }, null)).toBe(false);
    expect(isSessionMfaVerified({ mfaVerified: true, mfaMethod: 'email_code' }, null)).toBe(true);
    expect(isSessionMfaVerified({ mfaVerified: true, mfaMethod: 'trusted_device' }, null)).toBe(
      true,
    );
  });

  it('only counts strong factors for roles that require MFA', () => {
    expect(isSessionMfaVerified({ mfaVerified: true, mfaMethod: 'email_code' }, 'manager')).toBe(
      false,
    );
    expect(
      isSessionMfaVerified({ mfaVerified: true, mfaMethod: 'trusted_device' }, 'platform_admin'),
    ).toBe(false);
    expect(isSessionMfaVerified({ mfaVerified: true, mfaMethod: null }, 'manager')).toBe(false);
    // Every provider that can prove MFA, whether or not it's configured now.
    ['authenticator', 'backup_code', 'passkey', ...MFA_PROVIDERS].forEach((method) => {
      expect(isSessionMfaVerified({ mfaVerified: true, mfaMethod: method }, 'manager')).toBe(true);
    });
    // A provider that can't prove MFA never does.
    expect(isSessionMfaVerified({ mfaVerified: true, mfaMethod: 'google' }, 'manager')).toBe(false);
  });
});

describe('mfaConfirmedUntil', () => {
  /** When the second step was proven. */
  const verifiedAt = new Date('2026-10-26T12:00:00Z');

  /** The end of the window opened at {@link verifiedAt}. */
  const until = new Date('2026-10-26T12:15:00Z');

  it('lasts 15 minutes', () => {
    expect(RECENT_MFA_MS).toBe(15 * 60 * 1000);
  });

  it('ends 15 minutes after the second step', () => {
    expect(
      mfaConfirmedUntil(
        { mfaVerified: true, mfaMethod: 'authenticator', mfaVerifiedAt: verifiedAt },
        null,
        authenticatorApp,
      ),
    ).toEqual(until);
    expect(
      mfaConfirmedUntil(
        { mfaVerified: true, mfaMethod: 'passkey', mfaVerifiedAt: verifiedAt },
        'manager',
        { ...bare, passkeyCount: 1 },
      ),
    ).toEqual(until);
    // Email codes count for roles that don't require MFA.
    expect(
      mfaConfirmedUntil(
        { mfaVerified: true, mfaMethod: 'email_code', mfaVerifiedAt: verifiedAt },
        'support',
        emailCodes,
      ),
    ).toEqual(until);
  });

  it('accepts the time as an ISO string, as the session may give it', () => {
    expect(
      mfaConfirmedUntil(
        { mfaVerified: true, mfaMethod: 'github', mfaVerifiedAt: '2026-10-26T12:00:00.000Z' },
        'company_admin',
        githubOnly,
      ),
    ).toEqual(until);
  });

  it('has no window without a time, e.g. for sessions from before it was stored', () => {
    expect(
      mfaConfirmedUntil(
        { mfaVerified: true, mfaMethod: 'authenticator', mfaVerifiedAt: null },
        null,
        authenticatorApp,
      ),
    ).toBeNull();
  });

  it('has no window for a trusted device, even where it counts as verified', () => {
    // A trusted device counts as MFA verified for roles that don't require MFA...
    expect(isSessionMfaVerified({ mfaVerified: true, mfaMethod: 'trusted_device' }, null)).toBe(
      true,
    );
    // ...but nothing was proven at that sign-in, so it never confirms a change.
    expect(
      mfaConfirmedUntil(
        { mfaVerified: true, mfaMethod: 'trusted_device', mfaVerifiedAt: verifiedAt },
        null,
        emailCodes,
      ),
    ).toBeNull();
  });

  it('has no window for a second step that doesn’t count for the role', () => {
    expect(
      mfaConfirmedUntil(
        { mfaVerified: true, mfaMethod: 'email_code', mfaVerifiedAt: verifiedAt },
        'platform_admin',
        emailCodes,
      ),
    ).toBeNull();
    expect(
      mfaConfirmedUntil(
        { mfaVerified: false, mfaMethod: null, mfaVerifiedAt: verifiedAt },
        null,
        authenticatorApp,
      ),
    ).toBeNull();
  });

  describe('for a provider that can prove MFA', () => {
    /** A session confirmed with GitHub (with 2FA) at {@link verifiedAt}. */
    const viaGitHub = { mfaVerified: true, mfaMethod: 'github', mfaVerifiedAt: verifiedAt };

    it.each([...REQUIRED_ROLES, ...OPTIONAL_ROLES])(
      'opens the window when it is the only strong step (%s)',
      (role) => {
        expect(mfaConfirmedUntil(viaGitHub, role, githubOnly)).toEqual(until);
        // Next to a password, or email codes: neither is stronger than GitHub.
        expect(mfaConfirmedUntil(viaGitHub, role, { ...githubOnly, hasPassword: true })).toEqual(
          until,
        );
        expect(
          mfaConfirmedUntil(viaGitHub, role, { ...githubOnly, twoFactorEnabled: true }),
        ).toEqual(until);
      },
    );

    it.each([...REQUIRED_ROLES, ...OPTIONAL_ROLES])(
      'opens no window next to a passkey or an authenticator app, though the session counts (%s)',
      (role) => {
        const withPasskey: MfaState = { ...githubOnly, passkeyCount: 1 };
        const withApp: MfaState = { ...githubOnly, twoFactorEnabled: true, authenticator: true };

        expect(mfaConfirmedUntil(viaGitHub, role, withPasskey)).toBeNull();
        expect(mfaConfirmedUntil(viaGitHub, role, withApp)).toBeNull();
        expect(isSessionMfaVerified(viaGitHub, role)).toBe(true);
        // The stronger steps themselves still open it.
        expect(
          mfaConfirmedUntil({ ...viaGitHub, mfaMethod: 'passkey' }, role, withPasskey),
        ).toEqual(until);
        expect(
          mfaConfirmedUntil({ ...viaGitHub, mfaMethod: 'authenticator' }, role, withApp),
        ).toEqual(until);
      },
    );

    it('counts an authenticator app only once its setup is finished', () => {
      // `authenticator` without two-step verification on is a setup that was never finished.
      expect(
        mfaConfirmedUntil(viaGitHub, 'manager', { ...githubOnly, authenticator: true }),
      ).toEqual(until);
    });
  });
});

describe('isMfaConfirmedRecently', () => {
  /** The end of a confirmation window. */
  const until = new Date('2026-10-26T12:15:00Z');

  it('is open until just before the end', () => {
    expect(isMfaConfirmedRecently(until, new Date('2026-10-26T12:00:00Z'))).toBe(true);
    expect(isMfaConfirmedRecently(until, new Date('2026-10-26T12:14:59.999Z'))).toBe(true);
  });

  it('is closed at and after the end', () => {
    expect(isMfaConfirmedRecently(until, new Date('2026-10-26T12:15:00Z'))).toBe(false);
    expect(isMfaConfirmedRecently(until, new Date('2026-10-26T13:00:00Z'))).toBe(false);
  });

  it('is closed without a window', () => {
    expect(isMfaConfirmedRecently(null, new Date('2026-10-26T12:00:00Z'))).toBe(false);
    expect(isMfaConfirmedRecently(null)).toBe(false);
  });

  it('checks against the current time by default', () => {
    expect(isMfaConfirmedRecently(new Date(Date.now() + 60_000))).toBe(true);
    expect(isMfaConfirmedRecently(new Date(Date.now() - 1))).toBe(false);
  });
});

describe('sessionMfaOf', () => {
  it('fills in what a reader left out', () => {
    expect(sessionMfaOf({})).toEqual({
      mfaVerified: false,
      mfaMethod: null,
      mfaVerifiedAt: null,
      fromRequestLink: false,
    });
    expect(sessionMfaOf({ fromRequestLink: null }).fromRequestLink).toBe(false);
    expect(sessionMfaOf({ fromRequestLink: true }).fromRequestLink).toBe(true);
  });
});

describe('a session the link in an email about a request started', () => {
  /** Such a session, as Better Auth stores it: no second factor. */
  const linked = sessionMfaOf({ fromRequestLink: true });

  it("doesn't count as having had a second factor, for any role", () => {
    expect(isSessionMfaVerified(linked, null)).toBe(false);
    REQUIRED_ROLES.forEach((role) => {
      expect(isSessionMfaVerified(linked, role)).toBe(false);
    });
  });

  it('opens no window for changing sign-in methods', () => {
    [...REQUIRED_ROLES, ...OPTIONAL_ROLES].forEach((role) => {
      expect(mfaConfirmedUntil(linked, role, authenticatorApp)).toBeNull();
    });
    expect(mfaConfirmedUntil(linked, null, bare)).toBeNull();
  });

  it('opens the window as usual once it was confirmed with a second step', () => {
    const verifiedAt = new Date('2026-10-26T12:00:00Z');
    expect(
      mfaConfirmedUntil(
        { ...linked, mfaVerified: true, mfaMethod: 'authenticator', mfaVerifiedAt: verifiedAt },
        null,
        authenticatorApp,
      ),
    ).toEqual(new Date(verifiedAt.getTime() + RECENT_MFA_MS));
  });
});

describe('signedInAtOf', () => {
  /** When the session signed in. */
  const createdAt = new Date('2026-10-26T12:00:00Z');

  it("is the session's sign-in time", () => {
    expect(signedInAtOf({ createdAt })).toEqual(createdAt);
    expect(signedInAtOf({ createdAt: createdAt.toISOString(), fromRequestLink: false })).toEqual(
      createdAt,
    );
  });

  it('is unknown without one', () => {
    expect(signedInAtOf({})).toBeNull();
    expect(signedInAtOf({ createdAt: null })).toBeNull();
  });

  it('never counts for a session the link in an email about a request started', () => {
    expect(signedInAtOf({ createdAt, fromRequestLink: true })).toBeNull();
  });
});
