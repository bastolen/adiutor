/**
 * @file What a viewer gets on a user's page: which tabs (Overview, Companies,
 * Activity, Manage) and which cards in them, from their permissions, whether
 * it's their own page and whether they may sign in as the user. The layout's
 * tabs and the pages (which end on the 404 page for a tab the viewer doesn't
 * get) decide with the same rules.
 */
import type { ImpersonationVerdict } from '@/lib/authz/impersonation';
import type { Permission } from '@/lib/authz/permissions';

/** A tab of the user's page, by the route segment it opens (`null` for Overview). */
export type UserTab = 'overview' | 'companies' | 'activity' | 'manage';

/** The route segment of each tab below the user's page, `null` for Overview (the page itself). */
export const USER_TAB_SEGMENTS: Readonly<Record<UserTab, string | null>> = {
  overview: null,
  companies: 'companies',
  activity: 'activity',
  manage: 'manage',
};

/** What a viewer gets on a user's page. */
export interface UserPageAccess {
  /** The tabs they get, in order. */
  tabs: readonly UserTab[];
  /** The Staff access card: staff Admins, on someone else's page. */
  canManageStaff: boolean;
  /** The signed-in devices (IP addresses and browsers): staff Admins. */
  seesDevices: boolean;
  /** Signing out everywhere and the Account access card: staff Admins, on someone else's page. */
  canManage: boolean;
  /** The Delete account card: staff Admins, on someone else's page. */
  canDelete: boolean;
  /** The recent activity: staff who see the audit log. */
  seesActivity: boolean;
  /**
   * The Sign in as user card, with whether the viewer may sign in as the user
   * and if not why; `null` without it (roles that can't sign in as anyone, and
   * your own page).
   */
  signInAs: Exclude<ImpersonationVerdict, 'role' | 'self'> | null;
}

/**
 * Works out what a viewer gets on a user's page. On their own page, the staff
 * access and account controls aren't offered (their sign-in methods are on
 * their Security page, and stepping down is in the staff settings), so they
 * get no Manage tab.
 *
 * @param permissions - The viewer's global permissions (`getGlobalPermissions`).
 * @param target - About the user on the page.
 * @param target.isSelf - Whether it's the viewer's own page.
 * @param target.signInAs - Whether the viewer may sign in as them (`impersonationVerdictFor`).
 * @returns The tabs and cards they get.
 */
export function userPageAccess(
  permissions: ReadonlySet<Permission>,
  { isSelf, signInAs }: { isSelf: boolean; signInAs: ImpersonationVerdict },
): UserPageAccess {
  const seesDevices = permissions.has('users:manage');
  const seesActivity = permissions.has('audit:view');
  const canManage = seesDevices && !isSelf;
  const canDelete = permissions.has('users:delete') && !isSelf;
  // Not for roles that can't sign in as anyone, nor on your own page.
  const offered = signInAs !== 'role' && signInAs !== 'self' ? signInAs : null;
  const tabs: UserTab[] = ['overview', 'companies'];
  if (seesDevices || seesActivity) {
    tabs.push('activity');
  }
  if (offered || canManage || canDelete) {
    tabs.push('manage');
  }
  return {
    tabs,
    canManageStaff: permissions.has('staff:manage') && !isSelf,
    seesDevices,
    canManage,
    canDelete,
    seesActivity,
    signInAs: offered,
  };
}
