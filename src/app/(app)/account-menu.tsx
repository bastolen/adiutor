/**
 * @file The account menu at the bottom of the sidebar: who's signed in,
 * account settings, the theme and sign-out (or, while a staff member is
 * signed in as a user, "Back to my account"), and above it the message when
 * signing out failed.
 */
'use client';

import { ChevronsUpDown, LogOut, Undo2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import ThemeMenuRow from '@/components/theme/theme-menu-row';
import useThemePreference from '@/components/theme/use-theme-preference';
import Alert from '@/components/ui/alert';
import Avatar from '@/components/ui/avatar';
import {
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/dropdown-menu';
import loadFresh from '@/components/ui/load-fresh';
import { focusRing } from '@/components/ui/styles';
import { useTransientState } from '@/components/ui/use-transient-state';
import cn from '@/lib/cn';
import displayName from '@/lib/display-name';
import loadAuthClient from '@/lib/sign-in/load-auth-client';

import useBackToOwnAccount from './use-back-to-own-account';

/**
 * Props for {@link AccountMenu}.
 */
interface AccountMenuProps {
  /** The signed-in user's name. */
  name: string;
  /** Their email address. */
  email: string;
  /**
   * Whether a staff member is signed in as this user: the menu then says so,
   * and "Back to my account" takes Sign out's place (signing out would end
   * the staff member's own session).
   */
  signedInAs?: boolean;
  /**
   * Called when "Account settings" is chosen, which goes to another page: the
   * mobile menu around the account menu closes, as for its other links.
   */
  onNavigate?: () => void;
}

/**
 * A button with the user's avatar, name and email that opens a menu with
 * "Account settings", the theme (System, Light or Dark as a row of icons,
 * stored and applied like the floating theme button on the public pages) and
 * "Sign out". Keyboard: Enter or Space opens it, arrow keys move (left and
 * right too within the theme row), Escape closes and returns focus to the
 * button.
 *
 * Choosing "Account settings" also calls `onNavigate`, so the mobile menu it
 * sits in closes when the page changes, like after its other links. The other
 * items load a new page anyway (Sign out, "Back to my account") or keep the
 * menu around them open (the theme).
 *
 * The auth client (for "Sign out") isn't part of the page: it loads when the
 * menu opens (`loadAuthClient`).
 *
 * When signing out fails (the server refused it, or the request never got
 * there), nothing loads afresh: the user is still signed in, so the sign-in
 * page would only send them back, in every tab, as if it had worked. A message
 * above the button says so instead, inline and as a toast like every error in
 * the app; focus is back on the button (the menu closed), so they can try
 * again.
 *
 * The theme hook runs here rather than in the menu, whose content only exists
 * while it's open: this way the theme keeps following the system on every app
 * page. The sidebar's copy is always mounted, even while hidden on small
 * screens.
 *
 * @param props - Menu props.
 * @param props.name - The user's name.
 * @param props.email - Their email address.
 * @param props.signedInAs - Whether a staff member is signed in as the user.
 * @param props.onNavigate - Called when "Account settings" is chosen.
 * @returns The account menu.
 */
export default function AccountMenu({
  name,
  email,
  signedInAs = false,
  onNavigate = undefined,
}: AccountMenuProps) {
  const t = useTranslations('navigation');
  const { goBack } = useBackToOwnAccount();
  const { preference, setPreference } = useThemePreference();
  const shownName = displayName({ name, email });
  // Gone when the user leaves the page and comes back, like every status message.
  const [signOutFailed, setSignOutFailed] = useTransientState(false);

  /**
   * Ends the session, then loads the sign-in page afresh (`loadFresh`): a
   * navigation within the app would keep this person's pages alive for the
   * next one to sign in on this browser. The browser's other tabs load
   * their own page afresh too (`everyTab`), which takes them to the sign-in
   * page, so none of them keeps showing this person's pages.
   *
   * Better Auth's client resolves with an `error` when the server refuses
   * (a 5xx, a rate limit) and rejects when the request never gets there (as
   * does loading the client): either way the session hasn't ended, so the
   * message shows and nothing loads.
   */
  const signOut = async () => {
    setSignOutFailed(false);
    try {
      const authClient = await loadAuthClient();
      const result = await authClient.signOut();
      if (result.error) {
        setSignOutFailed(true);
        return;
      }
    } catch {
      setSignOutFailed(true);
      return;
    }
    loadFresh('/auth', { everyTab: true });
  };

  return (
    <div className="flex flex-col gap-2">
      <Alert tone="error" alsoToast onDismiss={() => setSignOutFailed(false)}>
        {signOutFailed ? t('signOutFailed') : null}
      </Alert>
      {/* The auth client is only needed to sign out: it starts loading when the menu opens. */}
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
            {signedInAs && (
              <span className="truncate text-xs font-medium text-warning">
                {t('signedInAs.menuLabel')}
              </span>
            )}
            <span className="truncate text-sm font-medium text-foreground">{shownName}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </MenuTrigger>
        <MenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width)">
          <MenuLabel>{email}</MenuLabel>
          <MenuItem asChild onSelect={onNavigate}>
            <Link href="/account">
              <UserRound aria-hidden="true" />
              {t('accountSettings')}
            </Link>
          </MenuItem>
          <MenuSeparator />
          <ThemeMenuRow preference={preference} onChange={setPreference} />
          <MenuSeparator />
          {signedInAs ? (
            <MenuItem onSelect={goBack}>
              <Undo2 aria-hidden="true" />
              {t('signedInAs.back')}
            </MenuItem>
          ) : (
            <MenuItem onSelect={signOut}>
              <LogOut aria-hidden="true" />
              {t('signOut')}
            </MenuItem>
          )}
        </MenuContent>
      </MenuRoot>
    </div>
  );
}
