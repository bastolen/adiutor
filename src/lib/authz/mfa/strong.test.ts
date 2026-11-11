/**
 * @file Tests for strong MFA whatever the role: what starting to sign in as
 * someone asks of the staff member, Support included.
 */
import { describe, expect, it } from 'vitest';

import type { SessionMfa } from './session';
import { hasStrongMfa, strongMfaConfirmedUntil } from './strong';
import {
  authenticatorApp,
  bare,
  emailCodes,
  githubOnly,
  WITH_GITHUB,
  WITHOUT_GITHUB,
} from './test-helpers';

describe('hasStrongMfa', () => {
  it('counts an authenticator app, a passkey and provider MFA', () => {
    expect(hasStrongMfa(authenticatorApp, WITHOUT_GITHUB)).toBe(true);
    expect(hasStrongMfa({ ...bare, passkeyCount: 1 }, WITHOUT_GITHUB)).toBe(true);
    expect(hasStrongMfa(githubOnly, WITH_GITHUB)).toBe(true);
  });

  it("doesn't count email codes, which Support's own role would accept", () => {
    expect(hasStrongMfa(emailCodes, WITH_GITHUB)).toBe(false);
  });

  it('needs something set up, and the provider configured', () => {
    expect(hasStrongMfa(bare, WITH_GITHUB)).toBe(false);
    expect(hasStrongMfa(githubOnly, WITHOUT_GITHUB)).toBe(false);
  });
});

describe('strongMfaConfirmedUntil', () => {
  /** When the second step was proven. */
  const verifiedAt = new Date('2026-11-11T12:00:00Z');

  /** The end of the window opened at {@link verifiedAt}. */
  const until = new Date('2026-11-11T12:15:00Z');

  /**
   * A session confirmed at {@link verifiedAt} with a method.
   *
   * @param mfaMethod - How it was confirmed.
   * @returns The session's MFA facts.
   */
  const confirmedWith = (mfaMethod: string): SessionMfa => ({
    mfaVerified: true,
    mfaMethod,
    mfaVerifiedAt: verifiedAt,
  });

  it('opens 15 minutes after a strong second step', () => {
    expect(strongMfaConfirmedUntil(confirmedWith('authenticator'), authenticatorApp)).toEqual(
      until,
    );
    expect(strongMfaConfirmedUntil(confirmedWith('passkey'), { ...bare, passkeyCount: 1 })).toEqual(
      until,
    );
    expect(strongMfaConfirmedUntil(confirmedWith('github'), githubOnly)).toEqual(until);
  });

  it('never opens after an email code or on a trusted device, whatever the role', () => {
    expect(strongMfaConfirmedUntil(confirmedWith('email_code'), emailCodes)).toBeNull();
    expect(strongMfaConfirmedUntil(confirmedWith('trusted_device'), authenticatorApp)).toBeNull();
  });

  it("doesn't open after GitHub on an account with a passkey", () => {
    expect(
      strongMfaConfirmedUntil(confirmedWith('github'), { ...githubOnly, passkeyCount: 1 }),
    ).toBeNull();
  });

  it('needs a confirmed session', () => {
    expect(
      strongMfaConfirmedUntil(
        { mfaVerified: false, mfaMethod: null, mfaVerifiedAt: null },
        authenticatorApp,
      ),
    ).toBeNull();
  });
});
