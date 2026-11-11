/**
 * @file Tests for who may sign in as whom: every staff role against every kind
 * of user, and the reasons it's refused.
 */
import { describe, expect, it } from 'vitest';

import {
  type ImpersonatingStaff,
  type ImpersonationTarget,
  type ImpersonationVerdict,
  mayImpersonate,
  mayImpersonateAnyone,
  personalDataShown,
} from './impersonation';
import { getGlobalPermissions } from './permissions';
import { PLATFORM_ROLES, type PlatformRole } from './roles';

/** The staff member's user ID. */
const STAFF_ID = '01970000-0000-7000-8000-000000000001';

/** The user's ID. */
const TARGET_ID = '01970000-0000-7000-8000-000000000002';

/**
 * A staff member with strong MFA.
 *
 * @param platformRole - Their staff role, or `null`.
 * @returns The staff member as the rules see them.
 */
const staffWith = (platformRole: PlatformRole | null): ImpersonatingStaff => ({
  id: STAFF_ID,
  platformRole,
  strongMfa: true,
});

/** Each kind of user, active, by a name for the test table. */
const TARGETS = {
  'a staff Admin': { platformRole: 'platform_admin', companyRoles: [] },
  'a Manager': { platformRole: 'manager', companyRoles: [] },
  'a Finance member': { platformRole: 'finance', companyRoles: [] },
  'a Support member': { platformRole: 'support', companyRoles: [] },
  'a company Admin': { platformRole: null, companyRoles: ['admin'] },
  'an Admin in one company and a Client in another': {
    platformRole: null,
    companyRoles: ['client', 'admin'],
  },
  'a Client': { platformRole: null, companyRoles: ['client'] },
  'a Watcher': { platformRole: null, companyRoles: ['watcher'] },
  'a user in no company': { platformRole: null, companyRoles: [] },
} satisfies Record<string, Pick<ImpersonationTarget, 'platformRole' | 'companyRoles'>>;

/** The kinds of user in {@link TARGETS}. */
type TargetKind = keyof typeof TARGETS;

/**
 * An active user of a kind.
 *
 * @param kind - Which kind of user.
 * @returns The user as the rules see them.
 */
const target = (kind: TargetKind): ImpersonationTarget => ({
  id: TARGET_ID,
  deactivated: false,
  allowsStaffSignIn: true,
  ...TARGETS[kind],
});

describe('mayImpersonate', () => {
  /** What each staff role gets for each kind of user. */
  const EXPECTED: Record<PlatformRole, Record<TargetKind, ImpersonationVerdict>> = {
    platform_admin: {
      'a staff Admin': 'staff_admin',
      'a Manager': 'allowed',
      'a Finance member': 'allowed',
      'a Support member': 'allowed',
      'a company Admin': 'allowed',
      'an Admin in one company and a Client in another': 'allowed',
      'a Client': 'allowed',
      'a Watcher': 'allowed',
      'a user in no company': 'allowed',
    },
    manager: {
      'a staff Admin': 'staff_admin',
      'a Manager': 'staff',
      'a Finance member': 'staff',
      'a Support member': 'staff',
      'a company Admin': 'allowed',
      'an Admin in one company and a Client in another': 'allowed',
      'a Client': 'allowed',
      'a Watcher': 'allowed',
      'a user in no company': 'allowed',
    },
    support: {
      'a staff Admin': 'staff_admin',
      'a Manager': 'staff',
      'a Finance member': 'staff',
      'a Support member': 'staff',
      'a company Admin': 'company_admin',
      'an Admin in one company and a Client in another': 'company_admin',
      'a Client': 'allowed',
      'a Watcher': 'allowed',
      'a user in no company': 'allowed',
    },
    finance: {
      'a staff Admin': 'role',
      'a Manager': 'role',
      'a Finance member': 'role',
      'a Support member': 'role',
      'a company Admin': 'role',
      'an Admin in one company and a Client in another': 'role',
      'a Client': 'role',
      'a Watcher': 'role',
      'a user in no company': 'role',
    },
  };

  describe.each(PLATFORM_ROLES)('as %s', (role) => {
    it.each(Object.entries(EXPECTED[role]) as [TargetKind, ImpersonationVerdict][])(
      'signing in as %s gives %s',
      (kind, verdict) => {
        expect(mayImpersonate(staffWith(role), target(kind))).toBe(verdict);
      },
    );
  });

  it("refuses anyone who isn't staff", () => {
    expect(mayImpersonate(staffWith(null), target('a Client'))).toBe('role');
  });

  it('refuses your own account', () => {
    expect(
      mayImpersonate(staffWith('platform_admin'), { ...target('a Manager'), id: STAFF_ID }),
    ).toBe('self');
  });

  it('refuses a deactivated account', () => {
    expect(mayImpersonate(staffWith('manager'), { ...target('a Client'), deactivated: true })).toBe(
      'deactivated',
    );
  });

  it('refuses a user who turned sign-ins by staff off', () => {
    expect(
      mayImpersonate(staffWith('platform_admin'), {
        ...target('a Client'),
        allowsStaffSignIn: false,
      }),
    ).toBe('opted_out');
  });

  it('asks for strong MFA only once everything else allows it', () => {
    const withoutMfa = { ...staffWith('support'), strongMfa: false };
    expect(mayImpersonate(withoutMfa, target('a Client'))).toBe('needs_mfa');
    expect(mayImpersonate(withoutMfa, target('a company Admin'))).toBe('company_admin');
    expect(mayImpersonate(withoutMfa, { ...target('a Client'), deactivated: true })).toBe(
      'deactivated',
    );
  });
});

describe('mayImpersonateAnyone', () => {
  it('is staff Admins, Managers and Support', () => {
    expect(mayImpersonateAnyone('platform_admin')).toBe(true);
    expect(mayImpersonateAnyone('manager')).toBe(true);
    expect(mayImpersonateAnyone('support')).toBe(true);
    expect(mayImpersonateAnyone('finance')).toBe(false);
    expect(mayImpersonateAnyone(null)).toBe(false);
  });
});

describe('personalDataShown', () => {
  /**
   * What the account pages show to a staff role signed in as the user.
   *
   * @param role - The staff role.
   * @returns What shows.
   */
  const shownTo = (role: PlatformRole) =>
    personalDataShown({
      signedInAs: { staffPermissions: [...getGlobalPermissions({ platformRole: role })] },
    });

  it('shows everything to the user themselves', () => {
    expect(personalDataShown({ signedInAs: null })).toEqual({
      devices: true,
      accountNames: true,
      origins: true,
    });
  });

  it('shows staff only what they see on the user page', () => {
    expect(shownTo('platform_admin')).toEqual({ devices: true, accountNames: true, origins: true });
    expect(shownTo('manager')).toEqual({ devices: false, accountNames: false, origins: true });
    expect(shownTo('support')).toEqual({ devices: false, accountNames: false, origins: false });
  });
});
