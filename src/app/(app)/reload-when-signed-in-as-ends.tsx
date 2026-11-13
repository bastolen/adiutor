/**
 * @file Loads the page afresh once a staff member's sign-in as a user ("Sign
 * in as", see docs/decisions/0017-staff-sign-in-as-users.md) has ended by
 * itself: after its `IMPERSONATION_MINUTES`, or when the rules no longer
 * allow it (`no_longer_allowed`, e.g. the user turned sign-ins by staff
 * off). The server then acts as the staff member again, but a navigation
 * within the app doesn't fetch the layout again, so the banner would stay,
 * and the pages Next kept alive would still show the user: a full page load
 * (`loadFresh`) shows the staff member everywhere, with a toast that says
 * why (`showToastAfterLoad`). Mounted by the banner (`SignedInAsBanner`), so
 * only while signed in as someone.
 */
'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useEffectEvent, useRef } from 'react';

import loadFresh from '@/components/ui/load-fresh';
import { showToastAfterLoad } from '@/components/ui/toast';

import { signedInAsEndsAtAction } from './impersonation-actions';

/**
 * How long the tab waits after the end before it loads, in milliseconds, so
 * the server, which decides, finds it over.
 */
export const END_MARGIN_MS = 2000;

/** Props of {@link ReloadWhenSignedInAsEnds}. */
export interface ReloadWhenSignedInAsEndsProps {
  /** When it ends, as the server's ISO time, which also tells this sign-in from a later one. */
  endsAt: string;
  /**
   * How long until it ends, in milliseconds, as the server measured it when
   * it rendered the banner. It's counted from when this mounts, so a browser
   * clock that's off doesn't matter.
   */
  endsInMs: number;
  /** The toast for the page after the load, e.g. "Signing in as the user has ended. …". */
  endedMessage: string;
}

/**
 * The address of the current page, with its search and section.
 *
 * @returns E.g. `/companies/adiutor/members?page=2#members`.
 */
function currentPage(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

/**
 * Loads the current page afresh, once, when the sign-in as a user has ended:
 *
 * - its time is up (plus {@link END_MARGIN_MS}), only while the tab is
 *   visible: a hidden tab loads as it comes back into view, which also
 *   catches a timer the browser held up meanwhile;
 * - the server says it's over or another one took its place
 *   (`signedInAsEndsAtAction`), asked after each navigation within the app
 *   (which the server rendered for whoever it acts as) and when the tab
 *   comes back into view before the time is up. One question at a time,
 *   never on a timer; one that fails changes nothing.
 *
 * @param props - Component props.
 * @param props.endsAt - When it ends, as the server's ISO time.
 * @param props.endsInMs - How long until it ends, as the server measured it.
 * @param props.endedMessage - The toast for the page after the load.
 * @returns Nothing visible.
 */
export default function ReloadWhenSignedInAsEnds({
  endsAt,
  endsInMs,
  endedMessage,
}: ReloadWhenSignedInAsEndsProps) {
  const pathname = usePathname();
  // The page the check last ran for: the one the server rendered with the banner, at first.
  const checkedPathname = useRef(pathname);
  const ended = useRef(false);
  const checking = useRef(false);

  /** Loads the current page afresh, with the toast, once. */
  const end = useEffectEvent(() => {
    if (ended.current) {
      return;
    }
    ended.current = true;
    showToastAfterLoad(endedMessage);
    loadFresh(currentPage());
  });

  /** Asks the server whether this sign-in still lasts, and ends when it doesn't. */
  const check = useEffectEvent(() => {
    if (ended.current || checking.current) {
      return;
    }
    checking.current = true;
    signedInAsEndsAtAction()
      .then((current) => {
        if (current !== endsAt) {
          end();
        }
      })
      .catch(() => {
        // The server wasn't reached (offline, a new deployment): the next navigation asks again.
      })
      .finally(() => {
        checking.current = false;
      });
  });

  useEffect(() => {
    const deadline = Date.now() + Math.max(0, endsInMs) + END_MARGIN_MS;
    let timer: number | undefined;

    /** Ends when it's time and the tab is visible, or waits until it's time. */
    const onTime = () => {
      const left = deadline - Date.now();
      if (left > 0) {
        timer = window.setTimeout(onTime, left);
        return;
      }
      // A hidden tab waits for `onVisible`.
      if (document.visibilityState === 'visible') {
        end();
      }
    };

    /** As the tab comes back into view: ends when its time is up, or asks the server. */
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      if (Date.now() >= deadline) {
        end();
      } else {
        check();
      }
    };

    onTime();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [endsInMs]);

  useEffect(() => {
    if (checkedPathname.current === pathname) {
      return;
    }
    checkedPathname.current = pathname;
    check();
  }, [pathname]);

  return null;
}
