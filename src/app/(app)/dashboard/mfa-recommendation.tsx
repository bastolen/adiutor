/**
 * @file Dismissible dashboard banner recommending a passkey or two-step
 * verification. The dismissal is remembered per user in this browser.
 */
'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import Banner from '@/components/ui/banner';
import Button from '@/components/ui/button';

/**
 * The `localStorage` key that remembers a user dismissed the banner in this
 * browser. It's per user, so someone else signing in on the browser still
 * sees the recommendation.
 *
 * @param userId - The signed-in user.
 * @returns The key.
 */
export function mfaRecommendationKey(userId: string): string {
  return `adiutor-mfa-recommendation-dismissed:${userId}`;
}

/** Event that tells this tab the dismissal changed. */
const CHANGE_EVENT = 'adiutor-mfa-recommendation-change';

/**
 * Reads whether a user dismissed the banner. Storage can be unavailable (e.g.
 * blocked cookies), in which case it counts as not dismissed.
 *
 * @param userId - The signed-in user.
 * @returns Whether they dismissed it.
 */
function readDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(mfaRecommendationKey(userId)) === '1';
  } catch {
    return false;
  }
}

/**
 * Listens for dismissals in this tab and others.
 *
 * @param onChange - Called when the dismissal may have changed.
 * @returns A function that stops listening.
 */
function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * On the server the dismissal is unknown, so the banner starts hidden and
 * appears after hydration only when it wasn't dismissed.
 *
 * @returns Always `true` (hidden).
 */
const getServerDismissed = () => true;

/**
 * A calm banner with a link to the Security page and a dismiss button. The
 * dismissal is remembered in this browser only, for this user only.
 *
 * @param props - Component props.
 * @param props.userId - The signed-in user.
 * @returns The banner, or nothing once dismissed.
 */
export default function MfaRecommendation({ userId }: { userId: string }) {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => readDismissed(userId),
    getServerDismissed,
  );
  if (dismissed) {
    return null;
  }

  /** Hides the banner and remembers it for this user. */
  const dismiss = () => {
    try {
      window.localStorage.setItem(mfaRecommendationKey(userId), '1');
    } catch {
      // Storage unavailable: the banner just comes back next time.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <Banner
      label="Account security"
      icon={ShieldCheck}
      tone="success"
      title="Protect your account"
      description="Add a passkey or two-step verification, so a stolen password isn't enough to get in."
      actions={
        <Button asChild size="sm">
          <Link href="/account/security">Set up</Link>
        </Button>
      }
      onDismiss={dismiss}
    />
  );
}
