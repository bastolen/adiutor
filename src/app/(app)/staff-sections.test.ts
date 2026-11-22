/**
 * @file Tests for the staff sections each role sees: Users and Companies for
 * every staff member, Settings for Admins, Logs for Admins and Managers, and
 * nothing for company users.
 */
import { describe, expect, it } from 'vitest';

import { getPermissions } from '@/lib/authz/permissions';
import type { PlatformRole } from '@/lib/authz/roles';

import { staffSectionKeys, staffSections } from './staff-sections';

/**
 * The global permissions of a staff role, or of a company user.
 *
 * @param platformRole - The staff role, or `null`.
 * @returns The permissions.
 */
function permissionsOf(platformRole: PlatformRole | null) {
  return getPermissions({ platformRole, companyRole: null, company: null });
}

describe('staffSectionKeys', () => {
  it.each<[PlatformRole | null, string[]]>([
    ['platform_admin', ['users', 'companies', 'settings', 'logs']],
    ['manager', ['users', 'companies', 'logs']],
    ['finance', ['users', 'companies']],
    ['support', ['users', 'companies']],
    [null, []],
  ])('gives %s the right sections', (role, expected) => {
    expect(staffSectionKeys(permissionsOf(role))).toEqual(expected);
  });
});

describe('staffSections', () => {
  it('keeps the sections in their own order', () => {
    expect(staffSections(['logs', 'users']).map(({ href }) => href)).toEqual([
      '/admin/users',
      '/admin/logs',
    ]);
  });
});
