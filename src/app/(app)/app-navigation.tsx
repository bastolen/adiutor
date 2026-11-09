/**
 * @file The signed-in app's navigation: a fixed sidebar on large screens, and
 * a top bar with a slide-over menu on small screens.
 */
'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import Logo from '@/components/brand/logo';
import Button from '@/components/ui/button';
import Sheet from '@/components/ui/sheet';
import { focusRing } from '@/components/ui/styles';
import { useTransientState } from '@/components/ui/use-transient-state';

import AccountMenu from './account-menu';
import NavLinks from './nav-links';

/**
 * Props for {@link AppNavigation}.
 */
interface AppNavigationProps {
  /** The signed-in user's name. */
  name: string;
  /** Their email address. */
  email: string;
  /** Whether they're staff; everyone else gets no navigation links yet. */
  isStaff: boolean;
  /** Whether they may manage the staff (Admins), which adds "Staff". */
  canManageStaff: boolean;
  /** Whether they may see the audit log (Admins and Managers), which adds "Logs". */
  canViewLogs: boolean;
}

/**
 * Logo, main navigation and account menu, used in both the sidebar and the
 * mobile menu.
 *
 * @param props - Panel props.
 * @param props.name - The user's name.
 * @param props.email - Their email address.
 * @param props.isStaff - Show staff links.
 * @param props.canManageStaff - Show the "Staff" link.
 * @param props.canViewLogs - Show the "Logs" link.
 * @param props.onNavigate - Called after navigating.
 * @returns The panel content.
 */
function NavigationPanel({
  name,
  email,
  isStaff,
  canManageStaff,
  canViewLogs,
  onNavigate = undefined,
}: AppNavigationProps & { onNavigate?: () => void }) {
  const t = useTranslations('navigation');
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link
        href="/dashboard"
        aria-label={t('dashboardLink')}
        onClick={onNavigate}
        className={`inline-flex w-fit rounded-md px-1.5 py-1 ${focusRing}`}
      >
        <Logo height={26} />
      </Link>
      {isStaff ? (
        <nav aria-label={t('main')} className="flex-1">
          <NavLinks
            canManageStaff={canManageStaff}
            canViewLogs={canViewLogs}
            onNavigate={onNavigate}
          />
        </nav>
      ) : (
        // No links yet for company users; an empty landmark would only be noise for screen readers.
        <div className="flex-1" />
      )}
      <AccountMenu name={name} email={email} />
    </div>
  );
}

/**
 * The navigation. On large screens it's a fixed sidebar. On small screens, a
 * top bar with a menu button opens it in a side `Sheet`: focus stays inside
 * while it's open, Escape closes it (focus goes back to the menu button), and
 * choosing a link closes it.
 *
 * @param props - Navigation props.
 * @param props.name - The user's name.
 * @param props.email - Their email address.
 * @param props.isStaff - Show staff links.
 * @param props.canManageStaff - Show the "Staff" link.
 * @param props.canViewLogs - Show the "Logs" link.
 * @returns The navigation.
 */
export default function AppNavigation({
  name,
  email,
  isStaff,
  canManageStaff,
  canViewLogs,
}: AppNavigationProps) {
  const t = useTranslations('navigation');
  const [open, setOpen] = useTransientState(false);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-surface lg:block">
        <NavigationPanel
          name={name}
          email={email}
          isStaff={isStaff}
          canManageStaff={canManageStaff}
          canViewLogs={canViewLogs}
        />
      </aside>

      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-surface/90 px-4 backdrop-blur-sm lg:hidden">
        <Link
          href="/dashboard"
          aria-label={t('dashboardLink')}
          className={`rounded-md ${focusRing}`}
        >
          <Logo height={24} />
        </Link>
        <Sheet
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button variant="ghost" size="sm" aria-label={t('openMenu')}>
              <Menu aria-hidden="true" />
            </Button>
          }
          title={t('menu')}
          description={t('menuDescription')}
          closeLabel={t('closeMenu')}
        >
          <NavigationPanel
            name={name}
            email={email}
            isStaff={isStaff}
            canManageStaff={canManageStaff}
            canViewLogs={canViewLogs}
            onNavigate={() => setOpen(false)}
          />
        </Sheet>
      </header>
    </>
  );
}
