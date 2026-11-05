/**
 * @file Tests for what a signed-in user must do first.
 */
import { describe, expect, it } from 'vitest';

import {
  FRESH_SIGN_IN_MS,
  mustSetUpMfa,
  mustStepUp,
  needsFreshSignIn,
  needsRecentConfirmation,
} from './actor-gates';

describe('mustSetUpMfa', () => {
  it('sends users whose role requires MFA until they have MFA they can use', () => {
    expect(mustSetUpMfa({ mfaRequired: true, mfaEnabled: false, canConfirmSessions: false })).toBe(
      true,
    );
    // Provider MFA while that provider's sign-in is off: on the account, but not usable here.
    expect(mustSetUpMfa({ mfaRequired: true, mfaEnabled: true, canConfirmSessions: false })).toBe(
      true,
    );
    expect(mustSetUpMfa({ mfaRequired: true, mfaEnabled: true, canConfirmSessions: true })).toBe(
      false,
    );
  });

  it("never sends users whose role doesn't require MFA", () => {
    expect(mustSetUpMfa({ mfaRequired: false, mfaEnabled: false, canConfirmSessions: false })).toBe(
      false,
    );
  });
});

describe('mustStepUp', () => {
  /** A user with MFA whose session hasn't had a second factor. */
  const unconfirmed = {
    canConfirmSessions: true,
    mfaEnabled: true,
    mfaRequired: false,
    sessionMfaVerified: false,
  };

  it('asks users with MFA to confirm a session without a second factor', () => {
    expect(mustStepUp(unconfirmed)).toBe(true);
    expect(mustStepUp({ ...unconfirmed, sessionMfaVerified: true })).toBe(false);
  });

  it("asks roles that require MFA to confirm with a second step that doesn't count yet", () => {
    expect(mustStepUp({ ...unconfirmed, mfaEnabled: false, mfaRequired: true })).toBe(true);
  });

  it('never asks users without a second step, or without MFA whose role allows that', () => {
    expect(mustStepUp({ ...unconfirmed, canConfirmSessions: false })).toBe(false);
    expect(mustStepUp({ ...unconfirmed, mfaEnabled: false })).toBe(false);
  });
});

describe('needsRecentConfirmation', () => {
  /** When the check runs. */
  const now = new Date('2026-10-26T12:00:00Z');

  it('needs a confirmation once the account has a second step and the window is closed', () => {
    expect(
      needsRecentConfirmation({ canConfirmSessions: true, mfaConfirmedUntil: null }, now),
    ).toBe(true);
    expect(
      needsRecentConfirmation(
        { canConfirmSessions: true, mfaConfirmedUntil: new Date('2026-10-26T11:59:00Z') },
        now,
      ),
    ).toBe(true);
  });

  it('lets the change through while the window is open', () => {
    expect(
      needsRecentConfirmation(
        { canConfirmSessions: true, mfaConfirmedUntil: new Date('2026-10-26T12:10:00Z') },
        now,
      ),
    ).toBe(false);
  });

  it('lets accounts without a second step through', () => {
    expect(
      needsRecentConfirmation({ canConfirmSessions: false, mfaConfirmedUntil: null }, now),
    ).toBe(false);
  });
});

describe('needsFreshSignIn', () => {
  /** When the check runs. */
  const now = new Date('2026-10-26T12:00:00Z');

  /**
   * The time a number of minutes before {@link now}.
   *
   * @param minutes - How many minutes.
   * @returns That time.
   */
  const before = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it('lasts an hour', () => {
    expect(FRESH_SIGN_IN_MS).toBe(60 * 60 * 1000);
  });

  it('needs a sign-in from the last hour on an account without a second step', () => {
    expect(needsFreshSignIn({ canConfirmSessions: false, signedInAt: before(59) }, now)).toBe(
      false,
    );
    expect(needsFreshSignIn({ canConfirmSessions: false, signedInAt: before(60) }, now)).toBe(true);
    expect(needsFreshSignIn({ canConfirmSessions: false, signedInAt: before(3 * 60) }, now)).toBe(
      true,
    );
  });

  it('counts a missing or unreadable sign-in time as too old', () => {
    expect(needsFreshSignIn({ canConfirmSessions: false, signedInAt: null }, now)).toBe(true);
    expect(
      needsFreshSignIn({ canConfirmSessions: false, signedInAt: new Date('not a date') }, now),
    ).toBe(true);
  });

  it('never applies to an account with a second step: that confirms changes instead', () => {
    expect(needsFreshSignIn({ canConfirmSessions: true, signedInAt: null }, now)).toBe(false);
    expect(needsFreshSignIn({ canConfirmSessions: true, signedInAt: before(3 * 60) }, now)).toBe(
      false,
    );
  });

  it('checks against the current time by default', () => {
    expect(needsFreshSignIn({ canConfirmSessions: false, signedInAt: new Date() })).toBe(false);
    expect(
      needsFreshSignIn({
        canConfirmSessions: false,
        signedInAt: new Date(Date.now() - FRESH_SIGN_IN_MS),
      }),
    ).toBe(true);
  });
});
