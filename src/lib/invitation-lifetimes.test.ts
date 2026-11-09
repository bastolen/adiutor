/**
 * @file Tests for how long invitations and invite links stay valid.
 */
import { describe, expect, it } from 'vitest';

import { INVITE_LINK_VALIDITY_DAYS, isInviteLinkValidity } from './invitation-lifetimes';

describe('isInviteLinkValidity', () => {
  it.each(INVITE_LINK_VALIDITY_DAYS)('allows %d days', (days) => {
    expect(isInviteLinkValidity(days)).toBe(true);
  });

  it.each([0, 2, 365, Number.NaN])('refuses %d days', (days) => {
    expect(isInviteLinkValidity(days)).toBe(false);
  });
});
