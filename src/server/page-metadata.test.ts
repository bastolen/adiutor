/**
 * @file Tests for the metadata of pages someone may not see: the page's own
 * metadata with the permission (and when its target exists), the 404 page's
 * title without, for permissions that aren't about one company and for a
 * company page's own permission.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission } from '@/lib/authz/permissions';
import type { PlatformRole } from '@/lib/authz/roles';
import { NOT_FOUND_METADATA } from '@/lib/not-found-metadata';

import type { Actor } from './actor';
import { findCompanyAccess, getActor } from './authz';
import { companyPermissionMetadata, globalPermissionMetadata } from './page-metadata';

vi.mock('server-only', () => ({}));
vi.mock('./authz', async () => {
  const { getPermissions } = await import('@/lib/authz/permissions');
  return {
    findCompanyAccess: vi.fn(),
    getActor: vi.fn(),
    /**
     * The real global permissions of the actor's staff role.
     *
     * @param actor - The actor.
     * @returns Their permissions.
     */
    getGlobalPermissions: (actor: Pick<Actor, 'platformRole'>) =>
      getPermissions({ platformRole: actor.platformRole, companyRole: null, company: null }),
  };
});

/** The Errors page's metadata for those who may see it. */
const ERRORS_METADATA = { title: 'Errors · Adiutor' };

/**
 * Signs someone in as the actor `getActor()` returns.
 *
 * @param platformRole - Their staff role, or `null` for a company user.
 * @returns The actor.
 */
function signInAs(platformRole: PlatformRole | null): Actor {
  const actor = { id: 'adiutor-tests-user', platformRole } as Actor;
  vi.mocked(getActor).mockResolvedValue(actor);
  return actor;
}

/**
 * Lets the user see the company, with some permissions in it.
 *
 * @param permissions - Their permissions in the company.
 */
function companyAccessWith(permissions: Permission[]) {
  vi.mocked(findCompanyAccess).mockResolvedValue({
    permissions: new Set(permissions),
  } as Awaited<ReturnType<typeof findCompanyAccess>>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('globalPermissionMetadata', () => {
  it("is the page's metadata for those with the permission", async () => {
    signInAs('platform_admin');
    const generateMetadata = globalPermissionMetadata('errors:view', ERRORS_METADATA);
    await expect(generateMetadata({})).resolves.toEqual(ERRORS_METADATA);
  });

  it("is the 404 page's for staff without it and for company users", async () => {
    const generateMetadata = globalPermissionMetadata('errors:view', ERRORS_METADATA);
    signInAs('manager');
    await expect(generateMetadata({})).resolves.toEqual(NOT_FOUND_METADATA);
    signInAs(null);
    await expect(generateMetadata({})).resolves.toEqual(NOT_FOUND_METADATA);
  });

  it('adds nothing for a layout whose viewer has the permission', async () => {
    signInAs('manager');
    await expect(globalPermissionMetadata('audit:view')({})).resolves.toEqual({});
  });

  it("asks whether the target exists only with the permission, with the actor and the page's props", async () => {
    const exists = vi.fn(async () => false);
    const generateMetadata = globalPermissionMetadata(
      'users:view',
      { title: 'User · Adiutor' },
      exists,
    );
    const props = { params: Promise.resolve({ userId: 'adiutor-tests-user' }) };

    signInAs(null);
    await expect(generateMetadata(props)).resolves.toEqual(NOT_FOUND_METADATA);
    expect(exists).not.toHaveBeenCalled();

    const support = signInAs('support');
    await expect(generateMetadata(props)).resolves.toEqual(NOT_FOUND_METADATA);
    expect(exists).toHaveBeenCalledWith(support, props);

    exists.mockResolvedValue(true);
    await expect(generateMetadata(props)).resolves.toEqual({ title: 'User · Adiutor' });
  });
});

describe('companyPermissionMetadata', () => {
  /** The props of a company page, for the company in its URL. */
  const props = { params: Promise.resolve({ companyId: 'adiutor-tests' }) };

  it("is the page's metadata with the permission in the company", async () => {
    companyAccessWith(['company:view', 'members:view']);
    await expect(
      companyPermissionMetadata('members:view', { title: 'Members' })(props),
    ).resolves.toEqual({ title: 'Members' });
    expect(findCompanyAccess).toHaveBeenCalledWith('adiutor-tests');
  });

  it("is the 404 page's for those who see the company without the permission", async () => {
    companyAccessWith(['company:view']);
    await expect(
      companyPermissionMetadata('members:view', { title: 'Members' })(props),
    ).resolves.toEqual(NOT_FOUND_METADATA);
  });

  it("is the 404 page's for those who can't see the company", async () => {
    vi.mocked(findCompanyAccess).mockResolvedValue(null);
    await expect(
      companyPermissionMetadata('company:update', { title: 'Settings' })(props),
    ).resolves.toEqual(NOT_FOUND_METADATA);
  });
});
