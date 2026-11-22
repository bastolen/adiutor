/**
 * @file Tests for what each staff role gets on a user's page: its tabs, and
 * the cards in them, on someone else's page and on their own.
 */
import { describe, expect, it } from 'vitest';

import type { ImpersonationVerdict } from '@/lib/authz/impersonation';
import { getPermissions } from '@/lib/authz/permissions';
import type { PlatformRole } from '@/lib/authz/roles';

import { userPageAccess } from './user-access';

/**
 * The global permissions of a staff role.
 *
 * @param platformRole - The staff role.
 * @returns The permissions.
 */
function permissionsOf(platformRole: PlatformRole) {
  return getPermissions({ platformRole, companyRole: null, company: null });
}

/**
 * What a role gets on a page.
 *
 * @param role - The viewer's staff role.
 * @param isSelf - Whether it's their own page.
 * @param signInAs - Whether they may sign in as the user.
 * @returns What they get.
 */
function accessOf(role: PlatformRole, isSelf: boolean, signInAs: ImpersonationVerdict) {
  return userPageAccess(permissionsOf(role), { isSelf, signInAs });
}

describe('userPageAccess', () => {
  it.each<[PlatformRole, ImpersonationVerdict, string[]]>([
    ['platform_admin', 'allowed', ['overview', 'companies', 'activity', 'manage']],
    ['manager', 'allowed', ['overview', 'companies', 'activity', 'manage']],
    // Managers see the audit log but no devices, and nothing to manage but signing in as.
    ['manager', 'staff_admin', ['overview', 'companies', 'activity', 'manage']],
    ['support', 'allowed', ['overview', 'companies', 'manage']],
    // A refusal still shows the card, saying why, so the tab stays.
    ['support', 'opted_out', ['overview', 'companies', 'manage']],
    ['finance', 'role', ['overview', 'companies']],
  ])('gives %s with sign-in as %s the tabs %j on someone else’s page', (role, verdict, tabs) => {
    expect(accessOf(role, false, verdict).tabs).toEqual(tabs);
  });

  it('gives staff Admins every card on someone else’s page', () => {
    expect(accessOf('platform_admin', false, 'allowed')).toEqual({
      tabs: ['overview', 'companies', 'activity', 'manage'],
      canManageStaff: true,
      seesDevices: true,
      canManage: true,
      canDelete: true,
      seesActivity: true,
      signInAs: 'allowed',
    });
  });

  it('gives Managers the activity but not the devices or account controls', () => {
    expect(accessOf('manager', false, 'allowed')).toMatchObject({
      canManageStaff: false,
      seesDevices: false,
      canManage: false,
      canDelete: false,
      seesActivity: true,
      signInAs: 'allowed',
    });
  });

  it('leaves out Manage and the staff access on your own page, keeping your devices', () => {
    expect(accessOf('platform_admin', true, 'self')).toEqual({
      tabs: ['overview', 'companies', 'activity'],
      canManageStaff: false,
      seesDevices: true,
      canManage: false,
      canDelete: false,
      seesActivity: true,
      signInAs: null,
    });
    expect(accessOf('support', true, 'self').tabs).toEqual(['overview', 'companies']);
  });
});
