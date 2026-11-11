/**
 * @file Who may sign in as whom: the rules of "Sign in as", where a staff
 * member sees Adiutor as one of its users, to check what isn't working for
 * them. Pure rules only; the service applies them when signing in as someone
 * starts and again on every request while it lasts.
 *
 * - Staff Admins may sign in as anyone except staff Admins.
 * - Managers may sign in as company users (anyone who isn't staff).
 * - Support may sign in as company users who aren't an Admin in any company,
 *   so it gives them no rights to manage members they don't have already.
 * - Finance, and anyone who isn't staff, may not.
 * - Nobody signs in as themselves or as a deactivated account, and the staff
 *   member needs strong MFA on their own account (`hasStrongMfa`).
 *
 * See docs/decisions/0017-staff-sign-in-as-users.md.
 */
import {
  COMPANY_ADMIN_ROLE,
  type CompanyRole,
  PLATFORM_ADMIN_ROLE,
  type PlatformRole,
} from './roles';

/**
 * Whom a staff role may sign in as:
 * - `all_but_staff_admins`: every user except staff Admins;
 * - `company_users`: users who aren't staff;
 * - `clients_and_watchers`: users who aren't staff and aren't an Admin in
 *   any company.
 */
type ImpersonationReach = 'all_but_staff_admins' | 'company_users' | 'clients_and_watchers';

/** Whom each staff role may sign in as, or `null` for nobody. */
const IMPERSONATION_REACH: Record<PlatformRole, ImpersonationReach | null> = {
  platform_admin: 'all_but_staff_admins',
  manager: 'company_users',
  finance: null,
  support: 'clients_and_watchers',
};

/** The staff member who would sign in as someone, as the rules see them. */
export interface ImpersonatingStaff {
  /** Their user ID. */
  id: string;
  /** Their staff role, or `null` when they aren't staff. */
  platformRole: PlatformRole | null;
  /** Whether their account has strong MFA (`hasStrongMfa`). */
  strongMfa: boolean;
}

/** The user someone would sign in as, as the rules see them. */
export interface ImpersonationTarget {
  /** Their user ID. */
  id: string;
  /** Their staff role, or `null` when they aren't staff. */
  platformRole: PlatformRole | null;
  /** Their role in each company they belong to, active or not. */
  companyRoles: readonly CompanyRole[];
  /** Whether their account is deactivated. */
  deactivated: boolean;
}

/**
 * Whether someone may sign in as a user, and if not, the first reason why:
 * - `allowed`: they may;
 * - `role`: their role can't sign in as anyone;
 * - `self`: it's their own account;
 * - `staff_admin`: the user is a staff Admin, as whom nobody signs in;
 * - `staff`: the user is staff, as whom only staff Admins sign in;
 * - `company_admin`: the user is an Admin in a company, as whom Support
 *   doesn't sign in;
 * - `deactivated`: the user's account is deactivated;
 * - `needs_mfa`: everything else allows it, but the staff member has no
 *   strong MFA on their own account.
 */
export type ImpersonationVerdict =
  | 'allowed'
  | 'role'
  | 'self'
  | 'staff_admin'
  | 'staff'
  | 'company_admin'
  | 'deactivated'
  | 'needs_mfa';

/**
 * Checks whether a staff role may sign in as anyone at all, e.g. to decide
 * whether the user detail page offers it.
 *
 * @param platformRole - The staff role, or `null` when not staff.
 * @returns Whether the role may sign in as some users.
 */
export function mayImpersonateAnyone(platformRole: PlatformRole | null): boolean {
  return platformRole !== null && IMPERSONATION_REACH[platformRole] !== null;
}

/**
 * Checks whether the user is outside what a reach allows, and says why.
 *
 * @param reach - Whom the staff member's role may sign in as.
 * @param target - The user.
 * @returns The reason the user is out of reach, or `null` when they're within it.
 */
function outOfReach(
  reach: ImpersonationReach,
  target: ImpersonationTarget,
): ImpersonationVerdict | null {
  if (target.platformRole === PLATFORM_ADMIN_ROLE) {
    return 'staff_admin';
  }
  if (reach === 'all_but_staff_admins') {
    return null;
  }
  if (target.platformRole !== null) {
    return 'staff';
  }
  if (reach === 'clients_and_watchers' && target.companyRoles.includes(COMPANY_ADMIN_ROLE)) {
    return 'company_admin';
  }
  return null;
}

/**
 * Decides whether a staff member may sign in as a user. The reasons are
 * checked in the order of {@link ImpersonationVerdict}, so the user detail
 * page names the one that matters most: a missing MFA setup only once
 * everything else allows it.
 *
 * @param staff - The staff member who would sign in as the user.
 * @param target - The user.
 * @returns `allowed`, or the reason they may not.
 */
export function mayImpersonate(
  staff: ImpersonatingStaff,
  target: ImpersonationTarget,
): ImpersonationVerdict {
  const reach = staff.platformRole === null ? null : IMPERSONATION_REACH[staff.platformRole];
  if (reach === null) {
    return 'role';
  }
  if (target.id === staff.id) {
    return 'self';
  }
  const refusal = outOfReach(reach, target);
  if (refusal) {
    return refusal;
  }
  if (target.deactivated) {
    return 'deactivated';
  }
  return staff.strongMfa ? 'allowed' : 'needs_mfa';
}
