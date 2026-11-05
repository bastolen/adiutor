/**
 * @file Tests for the permission matrix.
 */
import { describe, expect, it } from 'vitest';

import {
  getPermissions,
  mayRevealAccountExistence,
  mayUseInviteLinks,
  type Permission,
} from './permissions';
import { COMPANY_ROLES, type CompanyRole, PLATFORM_ROLES, type PlatformRole } from './roles';

/** An active company. */
const activeClient = { deactivated: false } as const;

/** A deactivated company. */
const deactivatedClient = { deactivated: true } as const;

/**
 * Lists permissions as a sorted array, for readable comparisons.
 *
 * @param permissions - The permission set.
 * @returns The permissions, sorted.
 */
const sorted = (permissions: Set<Permission>) => [...permissions].sort();

describe('staff permissions outside any company', () => {
  it.each<[PlatformRole, Permission[]]>([
    [
      'platform_admin',
      [
        'audit:view',
        'billing:manage',
        'billing:view',
        'company:create',
        'company:view',
        'errors:view',
        'staff:manage',
        'users:create',
        'users:delete',
        'users:manage',
        'users:view',
      ],
    ],
    ['manager', ['audit:view', 'company:create', 'company:view', 'users:create', 'users:view']],
    ['finance', ['billing:manage', 'billing:view', 'company:view', 'users:view']],
    ['support', ['company:view', 'users:view']],
  ])('%s', (role, expected) => {
    expect(
      sorted(getPermissions({ platformRole: role, companyRole: null, company: null })),
    ).toEqual(expected);
  });

  it('gives non-staff nothing', () => {
    expect(getPermissions({ platformRole: null, companyRole: 'admin', company: null }).size).toBe(
      0,
    );
  });
});

describe('staff in companies they are not members of', () => {
  it.each<[PlatformRole, Permission[]]>([
    [
      'platform_admin',
      ['company:deactivate', 'company:update', 'company:view', 'members:manage', 'members:view'],
    ],
    [
      'manager',
      ['company:deactivate', 'company:update', 'company:view', 'members:manage', 'members:view'],
    ],
    ['finance', ['company:view', 'members:view']],
    ['support', ['company:view', 'members:view']],
  ])('%s', (role, expected) => {
    const input = { platformRole: role, companyRole: null };
    expect(sorted(getPermissions({ ...input, company: activeClient }))).toEqual(expected);
    // Deactivation doesn't change what staff may do.
    expect(sorted(getPermissions({ ...input, company: deactivatedClient }))).toEqual(expected);
  });
});

describe('members of a company', () => {
  it.each<[CompanyRole, Permission[]]>([
    ['admin', ['app:use', 'company:view', 'members:manage', 'members:view']],
    ['client', ['app:use', 'company:view']],
    ['watcher', ['company:view']],
  ])('%s', (role, expected) => {
    expect(
      sorted(getPermissions({ platformRole: null, companyRole: role, company: activeClient })),
    ).toEqual(expected);
  });

  it('lose all access while the company is deactivated', () => {
    COMPANY_ROLES.forEach((role) => {
      expect(
        getPermissions({ platformRole: null, companyRole: role, company: deactivatedClient }).size,
      ).toBe(0);
    });
  });

  it('get nothing from a platform role passed as their company role', () => {
    expect(
      getPermissions({ platformRole: null, companyRole: 'platform_admin', company: activeClient })
        .size,
    ).toBe(0);
  });

  it('combine with staff permissions', () => {
    const permissions = getPermissions({
      platformRole: 'support',
      companyRole: 'client',
      company: activeClient,
    });
    expect(sorted(permissions)).toEqual(['app:use', 'company:view', 'members:view']);
  });
});

describe('mayRevealAccountExistence', () => {
  it('allows staff only', () => {
    PLATFORM_ROLES.forEach((role) => expect(mayRevealAccountExistence(role)).toBe(true));
    expect(mayRevealAccountExistence(null)).toBe(false);
  });
});

describe('mayUseInviteLinks', () => {
  it('lets everyone but Finance and Support use invite links', () => {
    expect(mayUseInviteLinks(null)).toBe(true);
    expect(mayUseInviteLinks('platform_admin')).toBe(true);
    expect(mayUseInviteLinks('manager')).toBe(true);
    expect(mayUseInviteLinks('finance')).toBe(false);
    expect(mayUseInviteLinks('support')).toBe(false);
  });
});
