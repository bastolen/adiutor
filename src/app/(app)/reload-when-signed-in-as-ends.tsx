/**
 * @file Loads the page afresh once a staff member's sign-in as a user ("Sign
 * in as", see docs/decisions/0017-staff-sign-in-as-users.md) has ended by
 * itself, after its `IMPERSONATION_MINUTES`. The server then acts as the
 * staff member again, but a navigation within the app doesn't fetch the
 * layout again, so the banner would stay, and the pages Next kept alive
 * would still show the user: a full page load (`loadFresh`) shows the staff
 * member everywhere, with a toast that says why (`showToastAfterLoad`).
 * Mounted by the banner (`SignedInAsBanner`), so only while signed in as
 * someone.
 */
'use client';

import { useEffect } from 'react';

import loadFresh from '@/components/ui/load-fresh';
import { showToastAfterLoad } from '@/components/ui/toast';

/**
 * How long the tab waits after the end before it loads, in milliseconds, so
 * the server, which decides, finds it over.
 */
export const END_MARGIN_MS = 2000;

/** Props of {@link ReloadWhenSignedInAsEnds}. */
export interface ReloadWhenSignedInAsEndsProps {
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
 * Loads the current page afresh once the sign-in as a user has ended (its
 * time plus {@link END_MARGIN_MS}), only while the tab is visible: a hidden
 * tab loads as it comes back into view. That also catches a timer the
 * browser held up while the tab was hidden. It loads once.
 *
 * @param props - Component props.
 * @param props.endsInMs - How long until it ends, as the server measured it.
 * @param props.endedMessage - The toast for the page after the load.
 * @returns Nothing visible.
 */
export default function ReloadWhenSignedInAsEnds({
  endsInMs,
  endedMessage,
}: ReloadWhenSignedInAsEndsProps) {
  useEffect(() => {
    const deadline = Date.now() + Math.max(0, endsInMs) + END_MARGIN_MS;
    let timer: number | undefined;
    let ended = false;

    /** Loads the page if it's time and the tab is visible, or waits until it's time. */
    const endIfDue = () => {
      if (ended) {
        return;
      }
      const left = deadline - Date.now();
      if (left > 0) {
        window.clearTimeout(timer);
        timer = window.setTimeout(endIfDue, left);
        return;
      }
      // A hidden tab waits: it comes back here when it's visible again.
      if (document.visibilityState !== 'visible') {
        return;
      }
      ended = true;
      showToastAfterLoad(endedMessage);
      loadFresh(currentPage());
    };

    endIfDue();
    document.addEventListener('visibilitychange', endIfDue);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', endIfDue);
    };
  }, [endsInMs, endedMessage]);

  return null;
}
