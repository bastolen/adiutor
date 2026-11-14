/**
 * @file Tests for the permission matrix.
 */
import { describe, expect, it } from 'vitest';

import {
  getGlobalPermissions,
  getPermissions,
  getStaffPermissionsInCompanies,
  managePermission,
  mayRevealAccountExistence,
  mayUseInviteLinks,
  type Permission,
} from './permissions';
import { COMPANY_ROLES, type CompanyRole, PLATFORM_ROLES, type PlatformRole } from './roles';

/** An active company. */
const activeClient = { deactivated: false } as const;

/** A deactivated company. */
const deactivatedClient = { deactivated: true } as const;

/** What the staff who work on requests may do with them, sorted. */
const REQUEST_WORK: Permission[] = [
  'requests:contribute',
  'requests:manage',
  'requests:view',
  'requests:view-internal',
];

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
        'jobs:manage',
        'jobs:view',
        'staff:manage',
        'users:create',
        'users:delete',
        'users:manage',
        'users:view',
      ],
    ],
    [
      'manager',
      ['audit:view', 'company:create', 'company:view', 'jobs:view', 'users:create', 'users:view'],
    ],
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
      [
        'company:deactivate',
        'company:update',
        'company:view',
        'members:manage',
        'members:view',
        ...REQUEST_WORK,
      ],
    ],
    [
      'manager',
      [
        'company:deactivate',
        'company:update',
        'company:view',
        'members:manage',
        'members:view',
        ...REQUEST_WORK,
      ],
    ],
    // Finance reads requests, with what only staff see, but can't take part.
    ['finance', ['company:view', 'members:view', 'requests:view', 'requests:view-internal']],
    ['support', ['company:view', 'members:view', ...REQUEST_WORK]],
  ])('%s', (role, expected) => {
    const input = { platformRole: role, companyRole: null };
    expect(sorted(getPermissions({ ...input, company: activeClient }))).toEqual(expected);
    // Deactivation doesn't change what staff may do.
    expect(sorted(getPermissions({ ...input, company: deactivatedClient }))).toEqual(expected);
  });
});

describe('members of a company', () => {
  it.each<[CompanyRole, Permission[]]>([
    [
      'admin',
      ['company:view', 'members:manage', 'members:view', 'requests:contribute', 'requests:view'],
    ],
    ['client', ['company:view', 'requests:contribute', 'requests:view']],
    // A Watcher follows requests without taking part, and nobody in a company sees the priority.
    ['watcher', ['company:view', 'requests:view']],
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
    // Finance only reads requests; being a Client of this company lets them take part in it.
    const permissions = getPermissions({
      platformRole: 'finance',
      companyRole: 'client',
      company: activeClient,
    });
    expect(sorted(permissions)).toEqual([
      'company:view',
      'members:view',
      'requests:contribute',
      'requests:view',
      'requests:view-internal',
    ]);
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

describe('getGlobalPermissions', () => {
  it.each(PLATFORM_ROLES)('gives %s what getPermissions gives outside any company', (role) => {
    expect(sorted(getGlobalPermissions({ platformRole: role }))).toEqual(
      sorted(getPermissions({ platformRole: role, companyRole: null, company: null })),
    );
  });

  it('gives nothing without a staff role', () => {
    expect(getGlobalPermissions({ platformRole: null }).size).toBe(0);
  });
});

describe('getStaffPermissionsInCompanies', () => {
  it.each(PLATFORM_ROLES)('gives %s what getPermissions gives in an active company', (role) => {
    expect(sorted(getStaffPermissionsInCompanies({ platformRole: role }))).toEqual(
      sorted(getPermissions({ platformRole: role, companyRole: null, company: activeClient })),
    );
  });

  it('gives nothing without a staff role', () => {
    expect(getStaffPermissionsInCompanies({ platformRole: null }).size).toBe(0);
  });
});

describe('managePermission', () => {
  it('is staff:manage for the staff and members:manage for a company', () => {
    expect(managePermission(null)).toBe('staff:manage');
    expect(managePermission('0190c3a8-0000-7000-8000-000000000001')).toBe('members:manage');
  });
});
