/**
 * @file The main navigation links in the sidebar: the dashboard and Requests
 * for everyone (`requests-section.ts`), then the staff sections the user may
 * see (`staff-sections.ts`).
 */
'use client';

import { LayoutDashboard, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { currentItem, focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';

import REQUESTS_SECTION from './requests-section';
import { type StaffSectionKey, staffSections } from './staff-sections';

/** A navigation item: the dashboard, Requests, then the user's staff sections. */
interface NavItem {
  /** Where it goes. The item is current on this path and everything under it. */
  href: string;
  /** Its label (`navigation.items`). */
  key: 'dashboard' | typeof REQUESTS_SECTION.key | StaffSectionKey;
  /** Decorative icon. */
  icon: LucideIcon;
}

/**
 * Props for {@link NavLinks}.
 */
interface NavLinksProps {
  /**
   * The staff sections the user may see (`staffSectionKeys`), after the
   * dashboard and Requests; none for company users.
   */
  sections: readonly StaffSectionKey[];
  /** Called after a link is chosen (closes the mobile menu). */
  onNavigate?: () => void;
}

/**
 * The navigation list. The current page's link is marked with
 * `aria-current="page"` and highlighted (outlined in forced-colours mode,
 * `currentItem`).
 *
 * @param props - Links props.
 * @param props.sections - The staff sections to link to.
 * @param props.onNavigate - Called after navigating.
 * @returns The list.
 */
export default function NavLinks({ sections, onNavigate = undefined }: NavLinksProps) {
  const t = useTranslations('navigation');
  const pathname = usePathname();
  const labels: Record<NavItem['key'], string> = {
    dashboard: t('items.dashboard'),
    requests: t('items.requests'),
    users: t('items.users'),
    companies: t('items.companies'),
    staff: t('items.staff'),
    logs: t('items.logs'),
  };
  const items: NavItem[] = [
    { href: '/dashboard', key: 'dashboard', icon: LayoutDashboard },
    REQUESTS_SECTION,
    ...staffSections(sections),
  ];

  return (
    <ul className="flex flex-col gap-0.5">
      {items.map(({ href, key, icon: Icon }) => {
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
                currentItem,
                current
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className={cn('size-4', current && 'text-highlight')} />
              {labels[key]}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
