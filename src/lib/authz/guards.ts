/**
 * @file Rules that guard role changes: a company, or the staff, is never left
 * without an admin, nobody gives themselves a higher staff or company role,
 * and giving a lasting way in (a staff role or a higher one, or the company
 * Admin role) needs a recent confirmation with the giver's second step.
 */
import {
  COMPANY_ADMIN_ROLE,
  type CompanyRole,
  type InviteTarget,
  isPlatformRole,
  type PlatformRole,
  type Role,
} from './roles';

/** Input for {@link wouldLeaveNoAdmin}. */
export interface AdminChange {
  /** The role that manages the people (`admin` in a company, `platform_admin` on the staff). */
  adminRole: Role;
  /** How many admins the company has now. */
  adminCount: number;
  /** The member's current role. */
  currentRole: Role;
  /** The member's new role, or `null` when they're being removed. */
  newRole: Role | null;
}

/**
 * Checks whether a role change or removal would take away the last admin of
 * a company or of the staff.
 *
 * @param change - The admin role and the change.
 * @param change.adminRole - The role that manages the people.
 * @param change.adminCount - How many admins it has now.
 * @param change.currentRole - The member's current role.
 * @param change.newRole - The new role, or `null` when removing.
 * @returns Whether the change must be refused.
 */
export function wouldLeaveNoAdmin({
  adminRole,
  adminCount,
  currentRole,
  newRole,
}: AdminChange): boolean {
  const losesAdmin = currentRole === adminRole && newRole !== adminRole;
  return losesAdmin && adminCount <= 1;
}

/**
 * How much each staff role may do, for comparing roles: Admin above Manager
 * above Finance and Support (which sit side by side).
 */
const STAFF_ROLE_RANK: Record<PlatformRole, number> = {
  platform_admin: 3,
  manager: 2,
  finance: 1,
  support: 1,
};

/**
 * Ranks a staff role, for comparing roles.
 *
 * @param role - The staff role, or `null` when not staff.
 * @returns The rank; 0 when not staff.
 */
function staffRoleRank(role: PlatformRole | null): number {
  return role ? STAFF_ROLE_RANK[role] : 0;
}

/**
 * Checks whether a staff role change gives more than the current role. Users
 * may only step down themselves (or stay); a raise for yourself is refused
 * even when your rights would allow it, e.g. with rights from before you
 * were demoted.
 *
 * @param currentRole - The current staff role, or `null` when not staff.
 * @param newRole - The new staff role, or `null` when leaving the staff.
 * @returns Whether the new role is higher than the current one.
 */
export function isStaffRoleRaise(
  currentRole: PlatformRole | null,
  newRole: PlatformRole | null,
): boolean {
  return staffRoleRank(newRole) > staffRoleRank(currentRole);
}

/**
 * How much each company role may do, for comparing roles: Admin above Client
 * above Watcher.
 */
const COMPANY_ROLE_RANK: Record<CompanyRole, number> = {
  admin: 3,
  client: 2,
  watcher: 1,
};

/**
 * Ranks a company role, for comparing roles.
 *
 * @param role - The company role, or `null` when not a member.
 * @returns The rank; 0 when not a member.
 */
function companyRoleRank(role: CompanyRole | null): number {
  return role ? COMPANY_ROLE_RANK[role] : 0;
}

/**
 * Checks whether a company role change gives more than the current role. Like
 * {@link isStaffRoleRaise}: members may only step down themselves (or stay);
 * a raise for yourself is refused even when your rights would allow it, e.g.
 * staff with a lower role in the company, or rights from before you were
 * demoted.
 *
 * @param currentRole - The current company role, or `null` when not a member.
 * @param newRole - The new company role, or `null` when leaving the company.
 * @returns Whether the new role is higher than the current one.
 */
export function isCompanyRoleRaise(
  currentRole: CompanyRole | null,
  newRole: CompanyRole | null,
): boolean {
  return companyRoleRank(newRole) > companyRoleRank(currentRole);
}

/**
 * What the giver is told when a role grant needs a recent confirmation they
 * don't have (see {@link grantNeedsConfirmation}).
 */
export const GRANT_CONFIRMATION_REQUIRED_MESSAGE =
  'Confirm it’s you with your second step before giving someone this role.';

/** A role being given to someone, for {@link grantNeedsConfirmation}. */
export interface RoleGrant {
  /** Whether it's a staff role or a role in a company. */
  target: InviteTarget;
  /** The role given. */
  role: Role;
  /**
   * The role they have there now, or `null` for none. Leave it out for an
   * invitation or invite link: nobody has the role until they accept.
   */
  from?: Role | null;
}

/**
 * Checks whether giving a role needs the giver's confirmation with their
 * second step from the last 15 minutes (`needsRecentConfirmation`), like a
 * change to how they sign in: these grants leave a lasting way in that a
 * stolen session could otherwise create for itself, which signing the victim
 * out wouldn't remove. They are:
 * - any staff role from an invitation or invite link, and any staff role
 *   change that's a raise (making someone staff included): even Support and
 *   Finance see every company;
 * - the company Admin role, given to someone who isn't one yet.
 * Stepping down, removing someone, and the company's Client and Watcher roles
 * need nothing.
 *
 * @param grant - The grant.
 * @param grant.target - The staff or a company.
 * @param grant.role - The role given.
 * @param grant.from - The role they have there now, if any; left out for invitations.
 * @returns Whether the giver must have confirmed recently.
 */
export function grantNeedsConfirmation({ target, role, from = null }: RoleGrant): boolean {
  if (target.type === 'staff') {
    return isPlatformRole(role) && isStaffRoleRaise(isPlatformRole(from) ? from : null, role);
  }
  return role === COMPANY_ADMIN_ROLE && from !== COMPANY_ADMIN_ROLE;
}
