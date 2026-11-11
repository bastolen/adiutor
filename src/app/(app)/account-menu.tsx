/**
 * @file The account menu at the bottom of the sidebar: who's signed in,
 * account settings, the theme and sign-out.
 */
'use client';

import { ChevronsUpDown, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import ThemeMenuRow from '@/components/theme/theme-menu-row';
import useThemePreference from '@/components/theme/use-theme-preference';
import Avatar from '@/components/ui/avatar';
import {
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/dropdown-menu';
import { focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';
import displayName from '@/lib/display-name';
import loadAuthClient from '@/lib/sign-in/load-auth-client';

/**
 * Props for {@link AccountMenu}.
 */
interface AccountMenuProps {
  /** The signed-in user's name. */
  name: string;
  /** Their email address. */
  email: string;
}

/**
 * A button with the user's avatar, name and email that opens a menu with
 * "Account settings", the theme (System, Light or Dark as a row of icons,
 * stored and applied like the floating theme button on the public pages) and
 * "Sign out". Keyboard: Enter or Space opens it, arrow keys move (left and
 * right too within the theme row), Escape closes and returns focus to the
 * button.
 *
 * The auth client (for "Sign out") isn't part of the page: it loads when the
 * menu opens (`loadAuthClient`).
 *
 * The theme hook runs here rather than in the menu, whose content only exists
 * while it's open: this way the theme keeps following the system on every app
 * page. The sidebar's copy is always mounted, even while hidden on small
 * screens.
 *
 * @param props - Menu props.
 * @param props.name - The user's name.
 * @param props.email - Their email address.
 * @returns The account menu.
 */
export default function AccountMenu({ name, email }: AccountMenuProps) {
  const t = useTranslations('navigation');
  const router = useRouter();
  const { preference, setPreference } = useThemePreference();
  const shownName = displayName({ name, email });

  /** Ends the session, then loads the sign-in page with a fresh cache. */
  const signOut = async () => {
    const authClient = await loadAuthClient();
    await authClient.signOut();
    router.replace('/auth');
    router.refresh();
  };

  return (
    // The auth client is only needed to sign out: it starts loading when the menu opens.
    <MenuRoot
      onOpenChange={(open) => {
        if (open) {
          // Only a head start: signing out loads it again and reports a failure.
          loadAuthClient().catch(() => undefined);
        }
      }}
    >
      <MenuTrigger
        className={cn(
          'flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted data-[state=open]:bg-muted',
          focusRing,
        )}
      >
        <Avatar name={shownName} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col">
          {/* Part of the button's name, which then contains its visible text (WCAG 2.5.3). */}
          <span className="sr-only">{t('accountMenu')}</span>
          <span className="truncate text-sm font-medium text-foreground">{shownName}</span>
          <span className="truncate text-xs text-muted-foreground">{email}</span>
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width)">
        <MenuLabel>{email}</MenuLabel>
        <MenuItem asChild>
          <Link href="/account">
            <UserRound aria-hidden="true" />
            {t('accountSettings')}
          </Link>
        </MenuItem>
        <MenuSeparator />
        <ThemeMenuRow preference={preference} onChange={setPreference} />
        <MenuSeparator />
        <MenuItem onSelect={signOut}>
          <LogOut aria-hidden="true" />
          {t('signOut')}
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}
