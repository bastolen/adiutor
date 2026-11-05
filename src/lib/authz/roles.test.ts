/**
 * @file Tests for role definitions.
 */
import { describe, expect, it } from 'vitest';

import {
  COMPANY_ROLES,
  isCompanyRole,
  isPlatformRole,
  isRole,
  isRoleAllowedFor,
  PLATFORM_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  roleOptions,
  rolesForTarget,
} from './roles';

describe('roles', () => {
  it('keeps staff (platform) and company roles apart', () => {
    expect(isRoleAllowedFor({ type: 'staff' }, 'manager')).toBe(true);
    expect(isRoleAllowedFor({ type: 'staff' }, 'admin')).toBe(false);
    expect(isRoleAllowedFor({ type: 'company' }, 'watcher')).toBe(true);
    expect(isRoleAllowedFor({ type: 'company' }, 'platform_admin')).toBe(false);
    expect(rolesForTarget({ type: 'staff' }).every(isPlatformRole)).toBe(true);
    expect(rolesForTarget({ type: 'company' }).every(isCompanyRole)).toBe(true);
  });

  it('recognises only known roles', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('owner')).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isPlatformRole('admin')).toBe(false);
    expect(isCompanyRole('support')).toBe(false);
  });
});

describe('roleOptions', () => {
  it('lists the roles in order, with their label and description', () => {
    expect(roleOptions(COMPANY_ROLES)).toEqual(
      COMPANY_ROLES.map((role) => ({
        value: role,
        label: ROLE_LABELS[role],
        description: ROLE_DESCRIPTIONS[role],
      })),
    );
    expect(roleOptions(PLATFORM_ROLES).map((option) => option.value)).toEqual([...PLATFORM_ROLES]);
  });

  it('gives nothing for no roles', () => {
    expect(roleOptions([])).toEqual([]);
  });
});
