/**
 * @file The staff shortcuts on the dashboard: tiles for the users and
 * companies lists, for Admins the staff page, and for Admins and Managers
 * the logs.
 */
import { ArrowRight, Building2, type LucideIcon, ScrollText, UserCog, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';

/** A shortcut tile. */
interface Shortcut {
  /** Where it goes. */
  href: string;
  /** Visible title. */
  title: string;
  /** One sentence on what's there. */
  description: string;
  /** Decorative icon. */
  icon: LucideIcon;
}

/**
 * The staff shortcuts, in order. Admins also get "Staff"; Admins and Managers
 * "Logs".
 *
 * @param t - Translates the `dashboard` namespace.
 * @param canManageStaff - Whether the user may manage the staff (Admins).
 * @param canViewLogs - Whether the user may see the audit log (Admins and Managers).
 * @returns The shortcuts.
 */
function shortcuts(
  t: ReturnType<typeof useTranslations<'dashboard'>>,
  canManageStaff: boolean,
  canViewLogs: boolean,
): Shortcut[] {
  const items: Shortcut[] = [
    {
      href: '/admin/users',
      title: t('shortcuts.users.title'),
      description: t('shortcuts.users.description'),
      icon: Users,
    },
    {
      href: '/admin/companies',
      title: t('shortcuts.companies.title'),
      description: t('shortcuts.companies.description'),
      icon: Building2,
    },
  ];
  if (canManageStaff) {
    items.push({
      href: '/admin/staff',
      title: t('shortcuts.staff.title'),
      description: t('shortcuts.staff.description'),
      icon: UserCog,
    });
  }
  if (canViewLogs) {
    items.push({
      href: '/admin/logs',
      title: t('shortcuts.logs.title'),
      description: t('shortcuts.logs.description'),
      icon: ScrollText,
    });
  }
  return items;
}

/**
 * Props for {@link StaffShortcuts}.
 */
interface StaffShortcutsProps {
  /** Whether the user may manage the staff (Admins), which adds "Staff". */
  canManageStaff: boolean;
  /** Whether the user may see the audit log (Admins and Managers), which adds "Logs". */
  canViewLogs: boolean;
}

/**
 * A grid of shortcut tiles, each a link with an icon, title and description.
 * One column on phones, and never more than two from 640px, however many
 * tiles there are: an odd last tile keeps the others' width. Its text comes
 * from the `dashboard` namespace.
 *
 * @param props - Shortcuts props.
 * @param props.canManageStaff - Show "Staff".
 * @param props.canViewLogs - Show "Logs".
 * @returns The list of tiles.
 */
export default function StaffShortcuts({ canManageStaff, canViewLogs }: StaffShortcutsProps) {
  const t = useTranslations('dashboard');
  const items = shortcuts(t, canManageStaff, canViewLogs);

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {items.map(({ href, title, description, icon: Icon }) => (
        <li key={href}>
          <Link
            href={href}
            className={cn(
              'group flex h-full flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs transition-colors hover:border-border-strong',
              focusRing,
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Icon aria-hidden="true" className="size-5" />
            </span>
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                {title}
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </span>
              <span className="text-sm text-muted-foreground">{description}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
