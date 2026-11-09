/**
 * @file Tests for role definitions.
 */
import { describe, expect, it } from 'vitest';

import translator from '@/lib/i18n/translator';

import {
  COMPANY_ROLES,
  isCompanyRole,
  isPlatformRole,
  isRole,
  isRoleAllowedFor,
  PLATFORM_ROLES,
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
    expect(roleOptions(COMPANY_ROLES, translator('en-US', 'roles'))).toEqual([
      {
        value: 'admin',
        label: 'Admin',
        description: 'Raises requests and manages who in the company has access.',
      },
      {
        value: 'client',
        label: 'Client',
        description: 'Raises requests, comments on them and approves work.',
      },
      { value: 'watcher', label: 'Watcher', description: 'Follows requests without taking part.' },
    ]);
    expect(
      roleOptions(PLATFORM_ROLES, translator('en-US', 'roles')).map((option) => option.value),
    ).toEqual([...PLATFORM_ROLES]);
  });

  it("names the roles in the reader's language", () => {
    expect(roleOptions(['watcher'], translator('nl-NL', 'roles'))).toEqual([
      { value: 'watcher', label: 'Meekijker', description: expect.any(String) },
    ]);
    expect(roleOptions(['platform_admin'], translator('es-ES', 'roles'))[0]?.label).toBe(
      'Administrador',
    );
  });

  it('gives nothing for no roles', () => {
    expect(roleOptions([], translator('en-US', 'roles'))).toEqual([]);
  });
});
