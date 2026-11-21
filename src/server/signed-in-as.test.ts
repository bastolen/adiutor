/**
 * @file Tests for what work while a staff member is signed in as the actor
 * records, and who counts as acting.
 */
import { describe, expect, it } from 'vitest';

import assertNotSignedInAs, { actingUserId, signedInAsWork } from './signed-in-as';

/** A staff member signed in as the user. */
const SIGNED_IN_AS = {
  staffId: 'staff-id',
  staffName: 'Ann Staff',
  endsAt: new Date('2026-11-21T10:30:00Z'),
  returnTo: '/dashboard',
  staffPermissions: [],
};

describe('assertNotSignedInAs', () => {
  it('refuses while a staff member is signed in as the actor', () => {
    expect(() => assertNotSignedInAs({ signedInAs: SIGNED_IN_AS })).toThrow(
      expect.objectContaining({ code: 'signed_in_as' }),
    );
    expect(() => assertNotSignedInAs({ signedInAs: null })).not.toThrow();
  });
});

describe('signedInAsWork', () => {
  it('records the staff member signed in as the actor', () => {
    expect(signedInAsWork({ signedInAs: SIGNED_IN_AS })).toEqual({
      signedInAs: true,
      signedInAsStaffId: 'staff-id',
    });
  });

  it('records nobody for the actor’s own work', () => {
    expect(signedInAsWork({ signedInAs: null })).toEqual({
      signedInAs: false,
      signedInAsStaffId: null,
    });
  });
});

describe('actingUserId', () => {
  it('is the staff member while they’re signed in as the actor, else the actor', () => {
    expect(actingUserId({ id: 'user-id', signedInAs: SIGNED_IN_AS })).toBe('staff-id');
    expect(actingUserId({ id: 'user-id', signedInAs: null })).toBe('user-id');
  });
});
