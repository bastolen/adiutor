/**
 * @file Roles: which exist and what they're called.
 *
 * Staff have a platform role on their user account (`user.platform_role`),
 * which applies everywhere. Members of a company have a company role there
 * (Admin, Client or Watcher), one per company. An invitation or invite
 * link is either for a company (a company role) or for staff (a
 * platform role).
 */

/** Platform (staff) roles, from most to least powerful. */
export const PLATFORM_ROLES = ['platform_admin', 'manager', 'finance', 'support'] as const;

/** Roles in a company, from most to least powerful. */
export const COMPANY_ROLES = ['admin', 'client', 'watcher'] as const;

/** Every role, for invitations and invite links (which can be for either). */
export const ROLE_IDS = [...PLATFORM_ROLES, ...COMPANY_ROLES] as const;

/** A platform (staff) role. */
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** A role in a company. */
export type CompanyRole = (typeof COMPANY_ROLES)[number];

/** Any role. */
export type Role = (typeof ROLE_IDS)[number];

/** Display names per role. Both admin roles are shown as "Admin". */
export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: 'Admin',
  manager: 'Manager',
  finance: 'Finance',
  support: 'Support',
  admin: 'Admin',
  client: 'Client',
  watcher: 'Watcher',
};

/**
 * One-line explanation per role, shown when choosing a role. They describe
 * the intended request (ticket) workflow, which isn't built yet.
 */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  platform_admin: 'Manages staff, companies and settings.',
  manager: 'Manages companies and their people.',
  finance: 'Views all companies.',
  support: 'Works on requests.',
  admin: 'Raises requests and manages who in the company has access.',
  client: 'Raises requests, comments on them and approves work.',
  watcher: 'Follows requests without taking part.',
};

/**
 * Turns roles into options for a role picker, with what each role does.
 * Display data only: it says nothing about who may give a role.
 *
 * @param roles - The roles to offer, in the order to show them.
 * @returns One option per role: its ID, label and description.
 */
export function roleOptions(
  roles: readonly Role[],
): { value: Role; label: string; description: string }[] {
  return roles.map((role) => ({
    value: role,
    label: ROLE_LABELS[role],
    description: ROLE_DESCRIPTIONS[role],
  }));
}

/** The company role that manages a company's members. */
export const COMPANY_ADMIN_ROLE = 'admin' satisfies CompanyRole;

/** The platform role that manages the staff. */
export const PLATFORM_ADMIN_ROLE = 'platform_admin' satisfies PlatformRole;

/**
 * What an invitation or invite link is for: joining the staff, or joining a
 * company. Not stored as such: staff invitations have no company.
 */
export type InviteTarget = { type: 'staff' } | { type: 'company' };

/**
 * Lists the roles that can be given when joining a target.
 *
 * @param target - Staff or a company.
 * @returns Its roles, from most to least powerful.
 */
export function rolesForTarget(target: InviteTarget): readonly Role[] {
  return target.type === 'staff' ? PLATFORM_ROLES : COMPANY_ROLES;
}

/**
 * Checks whether a value is a known role.
 *
 * @param value - The value to check, e.g. from a form.
 * @returns Whether it is a {@link Role}.
 */
export function isRole(value: unknown): value is Role {
  return ROLE_IDS.includes(value as Role);
}

/**
 * Checks whether a role can be given when joining a target.
 *
 * @param target - Staff or a company.
 * @param role - The role to check.
 * @returns Whether the role belongs to that target.
 */
export function isRoleAllowedFor(target: InviteTarget, role: Role): boolean {
  return rolesForTarget(target).includes(role);
}

/**
 * Checks whether a role is a platform (staff) role.
 *
 * @param role - The role to check.
 * @returns Whether it is a {@link PlatformRole}.
 */
export function isPlatformRole(role: unknown): role is PlatformRole {
  return PLATFORM_ROLES.includes(role as PlatformRole);
}

/**
 * Checks whether a role is a company role.
 *
 * @param role - The role to check.
 * @returns Whether it is a {@link CompanyRole}.
 */
export function isCompanyRole(role: unknown): role is CompanyRole {
  return COMPANY_ROLES.includes(role as CompanyRole);
}
