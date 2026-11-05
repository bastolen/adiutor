/**
 * @file Tests for the guards on role changes: the last-admin rule, raising
 * your own staff or company role, and which grants need a recent
 * confirmation.
 */
import { describe, expect, it } from 'vitest';

import {
  type AdminChange,
  grantNeedsConfirmation,
  isCompanyRoleRaise,
  isStaffRoleRaise,
  type RoleGrant,
  wouldLeaveNoAdmin,
} from './guards';

describe('wouldLeaveNoAdmin', () => {
  it.each<[string, AdminChange, boolean]>([
    [
      'refuses removing the only admin',
      { adminRole: 'admin', adminCount: 1, currentRole: 'admin', newRole: null },
      true,
    ],
    [
      'refuses demoting the only admin',
      { adminRole: 'admin', adminCount: 1, currentRole: 'admin', newRole: 'client' },
      true,
    ],
    [
      'refuses demoting the only staff Admin',
      {
        adminRole: 'platform_admin',
        adminCount: 1,
        currentRole: 'platform_admin',
        newRole: 'manager',
      },
      true,
    ],
    [
      'allows removing an admin when another admin remains',
      { adminRole: 'admin', adminCount: 2, currentRole: 'admin', newRole: null },
      false,
    ],
    [
      'allows keeping the admin role',
      { adminRole: 'admin', adminCount: 1, currentRole: 'admin', newRole: 'admin' },
      false,
    ],
    [
      'allows removing someone who is not an admin',
      { adminRole: 'admin', adminCount: 1, currentRole: 'client', newRole: null },
      false,
    ],
  ])('%s', (_name, change, refused) => {
    expect(wouldLeaveNoAdmin(change)).toBe(refused);
  });
});

describe('isStaffRoleRaise', () => {
  it.each([
    ['manager', 'platform_admin', true],
    ['support', 'manager', true],
    ['finance', 'platform_admin', true],
    [null, 'support', true],
    ['platform_admin', 'manager', false],
    ['manager', 'finance', false],
    ['platform_admin', null, false],
    ['finance', 'support', false],
    ['support', 'finance', false],
    ['manager', 'manager', false],
  ] as const)('%s → %s is a raise: %s', (from, to, raise) => {
    expect(isStaffRoleRaise(from, to)).toBe(raise);
  });
});

describe('isCompanyRoleRaise', () => {
  it.each([
    ['client', 'admin', true],
    ['watcher', 'client', true],
    ['watcher', 'admin', true],
    [null, 'watcher', true],
    ['admin', 'client', false],
    ['admin', 'watcher', false],
    ['client', 'watcher', false],
    ['admin', null, false],
    ['watcher', null, false],
    ['admin', 'admin', false],
    ['client', 'client', false],
  ] as const)('%s → %s is a raise: %s', (from, to, raise) => {
    expect(isCompanyRoleRaise(from, to)).toBe(raise);
  });
});

describe('grantNeedsConfirmation', () => {
  /** The staff, as a grant's target. */
  const staff = { type: 'staff' } as const;
  /** A company, as a grant's target. */
  const company = { type: 'company' } as const;

  it.each<[string, RoleGrant, boolean]>([
    ['inviting anyone as staff Admin', { target: staff, role: 'platform_admin' }, true],
    ['inviting anyone as staff Support', { target: staff, role: 'support' }, true],
    ['inviting anyone as staff Finance', { target: staff, role: 'finance' }, true],
    ['making someone staff', { target: staff, role: 'support', from: null }, true],
    ['raising Support to Manager', { target: staff, role: 'manager', from: 'support' }, true],
    ['raising Manager to Admin', { target: staff, role: 'platform_admin', from: 'manager' }, true],
    ['stepping down to Manager', { target: staff, role: 'manager', from: 'platform_admin' }, false],
    ['moving Manager to Finance', { target: staff, role: 'finance', from: 'manager' }, false],
    ['keeping the same staff role', { target: staff, role: 'support', from: 'support' }, false],
    ['inviting a company Admin', { target: company, role: 'admin' }, true],
    ['making a Client the Admin', { target: company, role: 'admin', from: 'client' }, true],
    ['adding someone as Admin', { target: company, role: 'admin', from: null }, true],
    ['keeping an Admin an Admin', { target: company, role: 'admin', from: 'admin' }, false],
    ['inviting a Client', { target: company, role: 'client' }, false],
    ['inviting a Watcher', { target: company, role: 'watcher' }, false],
    ['making a Watcher a Client', { target: company, role: 'client', from: 'watcher' }, false],
    ['stepping an Admin down to Client', { target: company, role: 'client', from: 'admin' }, false],
  ])('%s: %s', (_case, grant, expected) => {
    expect(grantNeedsConfirmation(grant)).toBe(expected);
  });
});
