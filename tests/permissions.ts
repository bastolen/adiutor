/**
 * @file Permissions of someone in an active company, for the tests of rules
 * that decide by permission.
 */
import { getPermissions, type Permission } from '@/lib/authz/permissions';
import type { CompanyRole, PlatformRole } from '@/lib/authz/roles';

/**
 * The permissions of someone in an active company.
 *
 * @param platformRole - Their staff role, or `null`.
 * @param companyRole - Their role in the company, or `null` when they aren't a member.
 * @returns The permissions.
 */
export default function permissionsOf(
  platformRole: PlatformRole | null,
  companyRole: CompanyRole | null,
): Set<Permission> {
  return getPermissions({ platformRole, companyRole, company: { deactivated: false } });
}
