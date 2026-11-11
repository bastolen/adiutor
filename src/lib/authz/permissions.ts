/**
 * @file Permissions: what each role may do, as a pure function.
 *
 * A user's permissions for a company come from two places, combined:
 * - their platform (staff) role, which applies to every company;
 * - their own role in that company, if they're a member and it's active.
 *
 * Every page and server action checks permissions through this module (via
 * `src/server/authz.ts`); never compare roles directly elsewhere.
 */
import type { CompanyRole, PlatformRole, Role } from './roles';

/** Everything that can be allowed. */
export const PERMISSIONS = [
  /** Manage the staff: its name, invitations, invite links and staff roles. */
  'staff:manage',
  /** Register new companies. */
  'company:create',
  /** See a company (or, without a company, the list of all companies). */
  'company:view',
  /** Change a company's name and details. */
  'company:update',
  /** Deactivate or reactivate a company. */
  'company:deactivate',
  /** See every user account (the Users page and user details). */
  'users:view',
  /** Register user accounts (without companies or a staff role), who get a welcome email. */
  'users:create',
  /** Reset a user's MFA, sign them out everywhere, deactivate and reactivate accounts. */
  'users:manage',
  /** Delete user accounts permanently. */
  'users:delete',
  /** See the audit log. */
  'audit:view',
  /** See recorded errors and look up their references (Logs → Errors). */
  'errors:view',
  /** See a company's members, invitations and invite links. */
  'members:view',
  /** Invite, change roles of and remove a company's members. */
  'members:manage',
  /** See billing (reserved for later). */
  'billing:view',
  /** Manage billing (reserved for later). */
  'billing:manage',
  /** Use the app's features in a company. */
  'app:use',
] as const;

/** One permission. */
export type Permission = (typeof PERMISSIONS)[number];

/** The company a permission check is about. */
export interface CompanyContext {
  /** Whether the company is deactivated. */
  deactivated: boolean;
}

/** Input for {@link getPermissions}. */
export interface PermissionInput {
  /** The user's platform (staff) role, or `null` if they aren't staff. */
  platformRole: PlatformRole | null;
  /** The user's role in the company being checked, or `null` if not a member. */
  companyRole: Role | null;
  /** The company being checked, or `null` for checks that aren't about one company. */
  company: CompanyContext | null;
}

/**
 * What staff may do regardless of company (e.g. list companies and users,
 * register companies, manage the staff).
 */
const STAFF_GLOBAL: Record<PlatformRole, Permission[]> = {
  platform_admin: [
    'staff:manage',
    'company:create',
    'company:view',
    'users:view',
    'users:create',
    'users:manage',
    'users:delete',
    'audit:view',
    'errors:view',
    'billing:view',
    'billing:manage',
  ],
  manager: ['company:create', 'company:view', 'users:view', 'users:create', 'audit:view'],
  finance: ['company:view', 'users:view', 'billing:view', 'billing:manage'],
  support: ['company:view', 'users:view'],
};

/** What staff may do in any company, member or not. */
const STAFF_IN_COMPANY: Record<PlatformRole, Permission[]> = {
  platform_admin: [
    'company:view',
    'company:update',
    'company:deactivate',
    'members:view',
    'members:manage',
  ],
  manager: [
    'company:view',
    'company:update',
    'company:deactivate',
    'members:view',
    'members:manage',
  ],
  finance: ['company:view', 'members:view'],
  support: ['company:view', 'members:view'],
};

/** What members of a company may do in it while it's active. */
const COMPANY_MEMBER: Record<CompanyRole, Permission[]> = {
  admin: ['company:view', 'members:view', 'members:manage', 'app:use'],
  client: ['company:view', 'app:use'],
  watcher: ['company:view'],
};

/**
 * Works out what a user may do.
 *
 * Rules:
 * - Staff permissions (from the platform role) apply to every company and
 *   aren't affected by deactivation.
 * - Membership permissions apply only in that company, and only while it's
 *   active.
 * - Managing the staff needs the platform Admin role (`staff:manage`).
 *
 * @param input - The user's roles and the company being checked.
 * @param input.platformRole - The user's platform role, or `null`.
 * @param input.companyRole - The user's role in the company, or `null`.
 * @param input.company - The company being checked, or `null`.
 * @returns The set of allowed permissions.
 */
export function getPermissions({
  platformRole,
  companyRole,
  company,
}: PermissionInput): Set<Permission> {
  const allowed = new Set<Permission>();
  /**
   * Adds permissions to the result.
   *
   * @param permissions - The permissions to allow.
   */
  const add = (permissions: Permission[]) => {
    permissions.forEach((permission) => allowed.add(permission));
  };

  if (!company) {
    if (platformRole) {
      add(STAFF_GLOBAL[platformRole]);
    }
    return allowed;
  }

  if (platformRole) {
    add(STAFF_IN_COMPANY[platformRole]);
  }
  if (companyRole && companyRole in COMPANY_MEMBER && !company.deactivated) {
    add(COMPANY_MEMBER[companyRole as CompanyRole]);
  }
  return allowed;
}

/**
 * Whether someone may see if an email address already has an account. Only
 * staff may; companies must never learn this.
 *
 * @param platformRole - The user's platform role, or `null`.
 * @returns Whether account existence may be revealed to them.
 */
export function mayRevealAccountExistence(platformRole: PlatformRole | null): boolean {
  return platformRole !== null;
}

/**
 * Staff roles that may only look at companies (their members and roles), not
 * change them.
 */
const VIEW_ONLY_STAFF_ROLES: readonly PlatformRole[] = ['finance', 'support'];

/**
 * Whether someone may join with an invite link, directly or by accepting the
 * invitation a link sends. Finance and Support may not, so a shareable link
 * can't give them company access; an invitation someone else sends them by
 * email still works.
 *
 * @param platformRole - The user's platform role, or `null`.
 * @returns Whether they may use invite links.
 */
export function mayUseInviteLinks(platformRole: PlatformRole | null): boolean {
  return platformRole === null || !VIEW_ONLY_STAFF_ROLES.includes(platformRole);
}

/**
 * A user's permissions that aren't about one company (e.g. registering
 * companies), from their staff role: the acting user as the request loaded
 * them, or their row as a transaction locked it (to check their rights
 * again with the same rules, e.g. in `setStaffRole`).
 *
 * @param subject - The acting user, or anything with their staff role.
 * @param subject.platformRole - Their staff role, or `null` for none.
 * @returns The permissions.
 */
export function getGlobalPermissions(subject: {
  platformRole: PlatformRole | null;
}): Set<Permission> {
  return getPermissions({ platformRole: subject.platformRole, companyRole: null, company: null });
}

/**
 * What staff may do in any active company (without being a member),
 * e.g. to decide whether to show membership controls on the user detail page.
 *
 * @param subject - The acting user, or anything with their staff role.
 * @param subject.platformRole - Their staff role, or `null` for none.
 * @returns The permissions; empty for non-staff.
 */
export function getStaffPermissionsInCompanies(subject: {
  platformRole: PlatformRole | null;
}): Set<Permission> {
  return getPermissions({
    platformRole: subject.platformRole,
    companyRole: null,
    company: { deactivated: false },
  });
}

/**
 * The permission that manages a target's people: `staff:manage` for the staff,
 * `members:manage` in a company (what `TargetAccess.canManage` stands for).
 *
 * @param companyId - The company, or `null` for staff.
 * @returns The permission.
 */
export function managePermission(companyId: string | null): Permission {
  return companyId === null ? 'staff:manage' : 'members:manage';
}
