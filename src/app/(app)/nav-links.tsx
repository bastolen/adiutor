/**
 * @file The main navigation links in the sidebar, for staff.
 */
'use client';

import {
  Building2,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  UserCog,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';

/** A navigation item. */
interface NavItem {
  /** Where it goes. The item is current on this path and everything under it. */
  href: string;
  /** Visible label. */
  label: string;
  /** Decorative icon. */
  icon: LucideIcon;
}

/**
 * The staff navigation items, in order. Admins also get "Staff"; Admins and
 * Managers "Logs".
 *
 * @param canManageStaff - Whether the user may manage the staff (Admins).
 * @param canViewLogs - Whether the user may see the audit log (Admins and Managers).
 * @returns The items.
 */
function staffItems(canManageStaff: boolean, canViewLogs: boolean): NavItem[] {
  const items: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/admin/users', label: 'Users', icon: Users },
    { href: '/admin/companies', label: 'Companies', icon: Building2 },
  ];
  if (canManageStaff) {
    items.push({ href: '/admin/staff', label: 'Staff', icon: UserCog });
  }
  if (canViewLogs) {
    items.push({ href: '/admin/logs', label: 'Logs', icon: ScrollText });
  }
  return items;
}

/**
 * Props for {@link NavLinks}.
 */
interface NavLinksProps {
  /** Whether the user may manage the staff (Admins), which adds "Staff". */
  canManageStaff: boolean;
  /** Whether the user may see the audit log (Admins and Managers), which adds "Logs". */
  canViewLogs: boolean;
  /** Called after a link is chosen (closes the mobile menu). */
  onNavigate?: () => void;
}

/**
 * The staff navigation list. The current page's link is marked with
 * `aria-current="page"` and highlighted.
 *
 * @param props - Links props.
 * @param props.canManageStaff - Show "Staff".
 * @param props.canViewLogs - Show "Logs".
 * @param props.onNavigate - Called after navigating.
 * @returns The list.
 */
export default function NavLinks({
  canManageStaff,
  canViewLogs,
  onNavigate = undefined,
}: NavLinksProps) {
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-0.5">
      {staffItems(canManageStaff, canViewLogs).map(({ href, label, icon: Icon }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors',
                focusRing,
                current
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className={cn('size-4', current && 'text-highlight')} />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
