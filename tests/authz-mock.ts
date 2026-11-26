/**
 * @file A stand-in for `@/server/authz` in the unit tests of the request
 * views, which read the viewer's staff permissions: each test sets
 * `getStaffPermissionsInCompanies`, and `getInternalRequestPermissions`
 * follows it as the real rule does (the request permissions of the staff
 * role, decision 0048). Use it as `vi.mock('@/server/authz', async () =>
 * (await import('<path>/tests/authz-mock')).default())`.
 */
import { vi } from 'vitest';

import type { Permission } from '@/lib/authz/permissions';

/**
 * Makes the mocked module.
 *
 * @returns Its functions.
 */
export default function authzMock() {
  const getStaffPermissionsInCompanies = vi.fn<(actor: unknown) => Set<Permission>>();
  return {
    getStaffPermissionsInCompanies,
    /**
     * The request permissions among the mocked staff permissions.
     *
     * @param actor - The viewer.
     * @returns The permissions.
     */
    getInternalRequestPermissions: (actor: unknown): Set<Permission> =>
      new Set(
        [...(getStaffPermissionsInCompanies(actor) ?? [])].filter((permission) =>
          permission.startsWith('requests:'),
        ),
      ),
  };
}
