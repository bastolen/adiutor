/**
 * @file The staff sections of the app (Users, Companies, Staff and Logs),
 * declared once for the sidebar (`NavLinks`) and the dashboard's tiles
 * (`Shortcuts`), with the permission each needs. A new section goes
 * here, and gets its text in `navigation.items` and `dashboard.shortcuts`.
 * Requests, which everyone gets, is in `requests-section.ts`.
 */
import { Building2, type LucideIcon, ScrollText, UserCog, Users } from 'lucide-react';

import type { Permission } from '@/lib/authz/permissions';

/** A staff section, by the key of its text in `navigation.items` and `dashboard.shortcuts`. */
export type StaffSectionKey = 'users' | 'companies' | 'staff' | 'logs';

/** A staff section. */
export interface StaffSection {
  /** Its text's key. */
  key: StaffSectionKey;
  /** Where it is. Its sidebar link is current on this path and everything under it. */
  href: string;
  /** Decorative icon. */
  icon: LucideIcon;
  /** What the user needs to see it. */
  permission: Permission;
}

/** The staff sections, in order. */
const STAFF_SECTIONS: readonly StaffSection[] = [
  { key: 'users', href: '/admin/users', icon: Users, permission: 'users:view' },
  { key: 'companies', href: '/admin/companies', icon: Building2, permission: 'company:view' },
  { key: 'staff', href: '/admin/staff', icon: UserCog, permission: 'staff:manage' },
  { key: 'logs', href: '/admin/logs', icon: ScrollText, permission: 'audit:view' },
];

/**
 * The sections a user may see: every staff member gets Users and Companies,
 * Admins also Staff, and Admins and Managers Logs. Company users get none.
 *
 * @param permissions - The user's global permissions (`getGlobalPermissions`).
 * @returns The keys of their sections, in order.
 */
export function staffSectionKeys(permissions: ReadonlySet<Permission>): StaffSectionKey[] {
  return STAFF_SECTIONS.filter(({ permission }) => permissions.has(permission)).map(
    ({ key }) => key,
  );
}

/**
 * The sections with these keys, in the order of {@link STAFF_SECTIONS}, for
 * the components that show them (their keys cross the boundary to client
 * components, the icons can't).
 *
 * @param keys - The sections' keys, from {@link staffSectionKeys}.
 * @returns The sections.
 */
export function staffSections(keys: readonly StaffSectionKey[]): StaffSection[] {
  return STAFF_SECTIONS.filter(({ key }) => keys.includes(key));
}
