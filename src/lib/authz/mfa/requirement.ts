/**
 * @file Which roles require MFA, and a user's MFA role (their staff role, or
 * `company_admin` for the Admin of an active company).
 */
import type { PlatformRole } from '../roles';

/**
 * Which MFA rules apply to a user: their staff role, or `company_admin` for
 * the Admin of an active company (when their staff role doesn't require MFA
 * itself).
 */
export type MfaRole = PlatformRole | 'company_admin';

/** Roles that must protect their account with MFA. */
const MFA_REQUIRED_ROLES: readonly MfaRole[] = ['platform_admin', 'manager', 'company_admin'];

/**
 * Checks whether a user must have MFA before using the app: staff Admins and
 * Managers, who can change every company and its people, and company Admins,
 * who manage their company's people.
 *
 * @param mfaRole - Which MFA rules apply to the user, or `null`.
 * @returns Whether MFA is required.
 */
export function requiresMfa(mfaRole: MfaRole | null): boolean {
  return mfaRole !== null && MFA_REQUIRED_ROLES.includes(mfaRole);
}

/**
 * Works out which MFA rules apply to a user: their staff role when it
 * requires MFA, otherwise `company_admin` when they're Admin of an active
 * company, otherwise their staff role (or `null`).
 *
 * @param platformRole - The user's staff role, or `null` if they aren't staff.
 * @param adminOfActiveCompany - Whether they're Admin of a company that isn't deactivated.
 * @returns The role to give the MFA rules.
 */
export function mfaRoleOf(
  platformRole: PlatformRole | null,
  adminOfActiveCompany: boolean,
): MfaRole | null {
  if (requiresMfa(platformRole)) {
    return platformRole;
  }
  return adminOfActiveCompany ? 'company_admin' : platformRole;
}
